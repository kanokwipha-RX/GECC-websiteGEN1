<?php
declare(strict_types=1);
namespace GECC;
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';

// CLI only. Credentials stay in this private directory and are never printed.
try {
    $command=$argv[1]??'check';
    if(!in_array($command,['check','prepare-units','check-units','apply-units','check-reviewers','apply-reviewers'],true))
        fail(400,'Usage: account-maintenance.php check | prepare-units FILE.json | check-units FILE.json | apply-units FILE.json REVISION | check-reviewers FILE.json | apply-reviewers FILE.json REVISION');
    $path=__DIR__.'/'.($argv[2]??'');
    if($command!=='check'&&(!preg_match('/^[A-Za-z0-9_-]+\.json$/D',$argv[2]??'')||in_array($argv[2],['accounts.json','config.local.json'],true)))
        fail(400,'ใช้ชื่อไฟล์ JSON ใหม่ภายใน private directory เท่านั้น ไม่ใช้ accounts.json');
    if($command!=='check'&&!str_starts_with($argv[2],str_ends_with($command,'units')?'unit-accounts':'reviewer-reconciliation'))
        fail(400,'ใช้ชื่อไฟล์ขึ้นต้น unit-accounts หรือ reviewer-reconciliation ตามชนิดงาน');
    $report=tx(function()use($command,$path,$argv){
        [$s,$revision]=state(true);
        $accounts=query('SELECT id,username,name,role,unit_id,team,active FROM gecc_accounts ORDER BY username FOR UPDATE')->fetchAll();
        $findUser=fn($username)=>find($accounts,fn($a)=>$a['username']===$username);
        if($command==='check') {
            $active=array_values(array_filter($accounts,fn($a)=>(bool)$a['active']));
            $options=public_login_options($s,$active);
            return ['revision'=>$revision,'totalAccounts'=>count($accounts),
                'unitsWithoutLogin'=>array_values(array_filter($options['units'],fn($u)=>$u['username']==='')),
                'mentorsWithoutLogin'=>array_values(array_filter($options['mentors'],fn($p)=>$p['username']==='')),
                'advisorsWithoutLogin'=>array_values(array_filter($options['advisors'],fn($p)=>$p['username']==='')),
                'reviewerAccounts'=>array_values(array_map(fn($a)=>['username'=>$a['username'],'name'=>$a['name'],'team'=>$a['team']===null?null:(int)$a['team'],'active'=>(bool)$a['active']],array_filter($accounts,fn($a)=>$a['role']==='mentor'))),
                'databaseChanged'=>false];
        }
        if($command==='prepare-units') {
            if(is_file($path))fail(409,'ไฟล์มีอยู่แล้ว ใช้ check-units เพื่อตรวจซ้ำ ไม่สร้างรหัสใหม่ทับ');
            $pending=[];
            foreach($s->units as $u) {
                if(find($accounts,fn($a)=>$a['role']==='mentee'&&$a['unit_id']===$u->id))continue;
                if($findUser($u->code))fail(409,'รหัสหน่วยงานถูกใช้โดยบัญชีอื่น ต้องตรวจสอบก่อน');
                $pending[]=(object)['username'=>$u->code,'name'=>$u->name,'unitId'=>$u->id,'password'=>rtrim(strtr(base64_encode(random_bytes(18)),'+/','-_'),'=')];
            }
            $fp=@fopen($path,'x+b');if(!$fp)fail(503,'สร้างไฟล์ส่วนตัวไม่ได้');
            try{chmod($path,0600);$data=encode((object)['format'=>'gecc-missing-units-v1','accounts'=>$pending]);if(fwrite($fp,$data)!==strlen($data))fail(503,'บันทึกไฟล์ส่วนตัวไม่ครบ');fflush($fp);}finally{fclose($fp);}
            return ['prepared'=>count($pending),'revision'=>$revision,'databaseChanged'=>false];
        }
        if(!is_file($path))fail(400,'ไม่พบไฟล์ส่วนตัว');
        $bundle=decode(file_get_contents($path));$apply=str_starts_with($command,'apply-');
        if($apply&&(!isset($argv[3])||!ctype_digit($argv[3])||(int)$argv[3]!==$revision))fail(409,'ใช้ revision จาก check ล่าสุด');
        if(!is_array($bundle->accounts??null))fail(400,'ไฟล์บัญชีไม่ถูกต้อง');
        if(($bundle->format??'')!==(str_ends_with($command,'units')?'gecc-missing-units-v1':'gecc-reviewer-reconciliation-v1'))fail(400,'รูปแบบไฟล์ไม่ตรงชนิดงาน');
        $pending=[];$seen=[];$skipped=0;
        foreach($bundle->accounts as $entry) {
            if(!is_object($entry)||!is_string($entry->username??null)||isset($seen[$entry->username]))fail(400,'ชื่อบัญชีซ้ำหรือไม่ถูกต้อง');
            $seen[$entry->username]=true;$old=$findUser($entry->username);
            if(str_ends_with($command,'units')) {
                if(($bundle->format??'')!=='gecc-missing-units-v1')fail(400,'รูปแบบไฟล์หน่วยงานไม่ถูกต้อง');
                $u=find($s->units,fn($u)=>$u->id===($entry->unitId??null));
                if(!$u||$u->code!==$entry->username||$u->name!==($entry->name??null)||!password_valid($entry->password??null))fail(409,'ชื่อหรือรหัสหน่วยงานเปลี่ยนไป กรุณาตรวจไฟล์ใหม่');
                if($old){if($old['role']!=='mentee'||$old['unit_id']!==$u->id)fail(409,'บัญชีเดิมมีสิทธิ์ต่างกัน ไม่เขียนทับ');$skipped++;continue;}
                if(find($accounts,fn($a)=>$a['role']==='mentee'&&$a['unit_id']===$u->id))fail(409,'หน่วยงานมีบัญชีอื่นอยู่แล้ว');
                $pending[]=$entry;
            } else {
                if(($bundle->format??'')!=='gecc-reviewer-reconciliation-v1'||($entry->identityConfirmed??null)!==true||!$old||$old['role']!=='mentor')fail(400,'ต้องยืนยันตัวบุคคลของบัญชี MENTOR เดิมเท่านั้น');
                if(!is_int($entry->team??null)||!is_string($entry->name??null)||!find($s->teams,fn($t)=>$t->id===$entry->team&&find($t->members??[],fn($p)=>$p->name===$entry->name)))fail(400,'ชื่อและกลุ่มต้องตรงรายชื่อ MENTOR ปัจจุบัน');
                if(find($accounts,fn($a)=>$a['id']!==$old['id']&&$a['name']===$entry->name&&$a['role']==='mentor'))fail(409,'ชื่อเป้าหมายมีบัญชี MENTOR อื่นอยู่แล้ว');
                foreach($pending as $p)if($p->name===$entry->name)fail(400,'จับคู่บุคคลเดียวกันซ้ำ');
                if($old['name']===$entry->name&&(int)$old['team']===$entry->team){$skipped++;continue;}
                if($old['name']!==($entry->expectedName??null)||(int)$old['team']!==($entry->expectedTeam??null))fail(409,'ชื่อหรือกลุ่มเดิมไม่ตรงกับไฟล์ที่ตรวจไว้');
                $pending[]=$entry;
            }
        }
        if($apply)foreach($pending as $entry) {
            if(str_ends_with($command,'units')) {
                $id=uid();query('INSERT INTO gecc_accounts(id,username,name,password_hash,role,unit_id,team) VALUES(?,?,?,?,?, ?,NULL)',[$id,$entry->username,$entry->name,password_hash_value($entry->password),'mentee',$entry->unitId]);
                audit(null,'provision-unit',$id,$revision);
            } else {
                $id=$findUser($entry->username)['id'];
                query('UPDATE gecc_accounts SET name=?,team=? WHERE id=?',[$entry->name,$entry->team,$id]);
                query('DELETE FROM gecc_sessions WHERE account_id=?',[$id]);
                audit(null,'reconcile-reviewer',$id,$revision);
            }
        }
        return ['applied'=>$apply,'revision'=>$revision,'pending'=>count($pending),'skipped'=>$skipped,'changes'=>array_map(fn($e)=>['username'=>$e->username,'name'=>$e->name,'team'=>$e->team??null,'unitId'=>$e->unitId??null],$pending),'passwordsChanged'=>false];
    });echo encode($report)."\n";
}catch(\Throwable $e){fwrite(STDERR,($e instanceof HttpError?$e->getMessage():'Account maintenance failed; inspect private logs.')."\n");exit(1);}
