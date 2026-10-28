<?php
declare(strict_types=1);
namespace GECC;
function account_plan(object $s): array {
    $list=[];
    foreach($s->units as $u) $list[]=['username'=>$u->code,'name'=>$u->name,'role'=>'mentee','unitId'=>$u->id,'team'=>null];
    foreach($s->teams as $t) foreach($t->members??[] as $i=>$p)
        $list[]=['username'=>'mentor-'.str_pad((string)$t->id,2,'0',STR_PAD_LEFT).'-'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT),
            'name'=>$p->name,'role'=>'mentor','unitId'=>null,'team'=>$t->id];
    foreach($s->mentorCoordinators??[] as $i=>$p)
        $list[]=['username'=>'coord-'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT),'name'=>$p->name,'role'=>'coord','unitId'=>null,'team'=>null];
    if (!count(array_filter($list,fn($a)=>$a['role']==='coord'))||count(array_unique(array_column($list,'username')))!==count($list)) fail(400,'รายชื่อบัญชีหรือรหัสหน่วยบริการไม่ครบ');
    return $list;
}
function prepare_accounts(object $s, string $path): void {
    if (file_exists($path)) return;
    $list=array_map(function($a){$a['password']=rtrim(strtr(base64_encode(random_bytes(18)),'+/','-_'),'=');return $a;},account_plan($s));
    $fp=@fopen($path,'x+b');if (!$fp) fail(503,'สร้างไฟล์บัญชีส่วนตัวไม่ได้');
    try {
        $data=encode(['format'=>'gecc-accounts-v1','createdAt'=>now(),'accounts'=>$list]);
        if (fwrite($fp,$data)!==strlen($data)) fail(503,'บันทึกไฟล์บัญชีส่วนตัวไม่สำเร็จ');
        fflush($fp);
    } finally {fclose($fp);}
    chmod($path,0600);
}
function provision_accounts(object $bundle, bool $apply=false): array {
    if (($bundle->format??'')!=='gecc-accounts-v1'||!is_array($bundle->accounts??null)) fail(400,'ไฟล์บัญชีไม่ถูกต้อง');
    return tx(function()use($bundle,$apply){
        [$s]=state(true);if (!empty($s->isSample)) fail(400,'ไม่สร้างบัญชีในข้อมูลสาธิต');
        $plan=account_plan($s);$seen=[];$pending=[];$skipped=0;
        if (count($bundle->accounts)!==count($plan)) fail(400,'จำนวนบัญชีไม่ตรงรายชื่อในระบบ');
        foreach($bundle->accounts as $a) {
            $p=find($plan,fn($p)=>$p['username']===($a->username??null));
            if (!$p||in_array($a->username,$seen,true)||!password_valid($a->password??null)) fail(400,'บัญชีหรือรหัสผ่านไม่ตรงรายชื่อ');
            foreach(['name','role','unitId','team'] as $k) if (!same($a->$k??null,$p[$k])) fail(400,'ชื่อหรือสิทธิ์บัญชีไม่ตรงรายชื่อ');
            $seen[]=$a->username;
            $old=query('SELECT * FROM gecc_accounts WHERE username=?',[$a->username])->fetch();
            if ($old) {
                if ($old['name']!==$a->name||$old['role']!==$a->role||$old['unit_id']!==$a->unitId||($old['team']===null?null:(int)$old['team'])!==$a->team) fail(409,'บัญชีเดิมมีชื่อหรือสิทธิ์ต่างกัน กรุณาตรวจสอบก่อน');
                $skipped++;
            } else $pending[]=$a;
        }
        if ($apply) foreach($pending as $a) {
            $id=uid();query('INSERT INTO gecc_accounts(id,username,name,password_hash,role,unit_id,team) VALUES(?,?,?,?,?,?,?)',
                [$id,$a->username,$a->name,password_hash_value($a->password),$a->role,$a->unitId,$a->team]);
            audit($id,'provision-account',$id);
        }
        return ['dryRun'=>!$apply,'total'=>count($plan),$apply?'created':'wouldCreate'=>count($pending),'skipped'=>$skipped];
    });
}
function install(): array {
    $key='gecc-install-'.substr(hash('sha256',config()['dsn']),0,24);
    if ((int)query('SELECT GET_LOCK(?,10)',[$key])->fetchColumn()!==1) fail(409,'มีการติดตั้งอื่นกำลังทำงาน');
    try {
        // MariaDB DDL commits implicitly. Schema is additive; account writes below
        // are a separate atomic transaction. Never drop/replace existing records.
        if (empty(config()['schema_preinstalled'])) {
            $sql=file_get_contents(__DIR__.'/schema.sql');
            foreach(explode(';',$sql) as $statement) if (trim($statement)!=='') db()->exec($statement);
        } else {
            foreach(['app_state','accounts','sessions','files','audit','login_attempts','schema_version'] as $table)
                query('SELECT 1 FROM gecc_'.$table.' LIMIT 1');
        }
        query('INSERT IGNORE INTO gecc_schema_version(version) VALUES(1)');
        $seed=decode(file_get_contents(__DIR__.'/data/seed.json'));
        query('INSERT IGNORE INTO gecc_app_state(id,document) VALUES(1,?)',[encode($seed)]);
        [$s]=state();$path=__DIR__.'/accounts.json';prepare_accounts($s,$path);
        $bundle=decode(file_get_contents($path));
        provision_accounts($bundle,false);
        $result=provision_accounts($bundle,true);
        if (!is_file(__DIR__.'/installed.lock')) {
            $fp=@fopen(__DIR__.'/installed.lock','x');
            if (!$fp) fail(503,'สร้างเครื่องหมายปิดตัวติดตั้งไม่สำเร็จ');
            fwrite($fp,now());fclose($fp);chmod(__DIR__.'/installed.lock',0600);
        }
        return $result+['schemaVersion'=>1,'ok'=>true];
    } finally {query('SELECT RELEASE_LOCK(?)',[$key]);}
}
function web_install(mixed $token): array {
    $c=config();
    if (empty($c['allow_web_setup'])||is_file(__DIR__.'/installed.lock')) fail(404,'ไม่พบรายการ');
    if (!is_string($token)||!preg_match('/^[a-f0-9]{64}$/D',$token)||!preg_match('/^[a-f0-9]{64}$/D',$c['setup_token_hash']??'')
        ||!hash_equals($c['setup_token_hash'],hash('sha256',$token))) fail(403,'รหัสติดตั้งไม่ถูกต้อง');
    @set_time_limit(120);
    return install();
}
