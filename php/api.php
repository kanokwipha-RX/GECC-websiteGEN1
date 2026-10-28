<?php
declare(strict_types=1);
namespace GECC;
function reply(mixed $v, int $status=200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    echo encode($v); exit;
}
function body(int $max=2097152, bool $raw=false): mixed {
    if ((int)($_SERVER['CONTENT_LENGTH']??0)>$max) fail(413,'ข้อมูลมีขนาดใหญ่เกินไป');
    $stream=fopen('php://input','rb');$data=stream_get_contents($stream,$max+1);fclose($stream);
    if (strlen($data)>$max) fail(413,'ข้อมูลมีขนาดใหญ่เกินไป');
    if ($raw) return $data;
    try {$v=decode($data);} catch(\JsonException) {fail(400,'ข้อมูล JSON ไม่ถูกต้อง');}
    if (!is_object($v)) fail(400,'ข้อมูล JSON ไม่ถูกต้อง'); return $v;
}
function file_type(string $b): ?string {
    if (str_starts_with($b,'%PDF-')) return 'application/pdf';
    if (str_starts_with($b,"\x89PNG\r\n\x1a\n")) return 'image/png';
    if (str_starts_with($b,"\xff\xd8\xff")) return 'image/jpeg';
    if (substr($b,0,4)==='RIFF' && substr($b,8,4)==='WEBP') return 'image/webp';
    return null;
}
function reserve_login(string $username): void {
    tx(function()use($username){
        $now=time();$key=hash('sha256',($_SERVER['REMOTE_ADDR']??'').':'.$username);
        query('DELETE FROM gecc_login_attempts WHERE reset_at < ? LIMIT 1000',[$now]);
        if ((int)query('SELECT COUNT(*) FROM gecc_login_attempts')->fetchColumn()>=10000) fail(429,'ระบบกำลังรับคำขอจำนวนมาก กรุณาลองใหม่ภายหลัง');
        query('INSERT IGNORE INTO gecc_login_attempts(key_hash,attempts,reset_at) VALUES(?,0,?)',[$key,$now+900]);
        $row=query('SELECT attempts FROM gecc_login_attempts WHERE key_hash=? FOR UPDATE',[$key])->fetch();
        if ((int)$row['attempts']>=10) fail(429,'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที');
        query('UPDATE gecc_login_attempts SET attempts=attempts+1 WHERE key_hash=?',[$key]);
    });
}
function file_checks(object $old, object $next, array $actor): void {
    foreach($next->units as $u) {
        $before=[]; foreach(collect_files($old->assess->{$u->id}??null) as $f) $before[$f->id]=$f;
        $files=collect_files($next->assess->{$u->id}??null);
        $role=$actor['role']==='coord'?'mentor':$actor['role'];
        foreach($before as $id=>$f) if (!find($files,fn($x)=>$x->id===$id)&&($f->by??null)!==$role&&$actor['role']!=='coord') fail(403,'ลบไฟล์แนบของอีกบทบาทไม่ได้');
        foreach($files as $f) {
            if (!valid_id($f->id??null)) fail(400,'รหัสไฟล์ไม่ถูกต้อง');
            $stored=query('SELECT f.*,a.role AS owner_role FROM gecc_files f JOIN gecc_accounts a ON a.id=f.account_id WHERE f.id=?',[$f->id])->fetch();
            if (!$stored || $stored['unit_id']!==$u->id) fail(400,'ไฟล์แนบยังไม่ถูกอัปโหลดหรือไม่ตรงหน่วยบริการ');
            $f->by=$before[$f->id]->by??($stored['owner_role']==='coord'?'mentor':$stored['owner_role']);
            $f->type=$stored['mime'];$f->size=(int)$stored['size'];
        }
    }
}
function api(): never {
    header('Referrer-Policy: strict-origin-when-cross-origin');header('X-Frame-Options: DENY');
    try {
        $c=config();$method=$_SERVER['REQUEST_METHOD'];$route=$_GET['route']??'';
        if ($c['secure_cookie'] && !in_array($_SERVER['HTTPS'] ?? '', ['on','1'], true))
            fail(400,'กรุณาเชื่อมต่อผ่าน HTTPS');
        if (!is_string($route)||!preg_match('~^[a-z]+(?:/[A-Za-z0-9_-]+)*$~D',$route)) fail(404,'ไม่พบรายการ');
        $modifying=!in_array($method,['GET','HEAD'],true);
        if ($modifying&&!in_array($_SERVER['HTTP_ORIGIN']??'',[$c['origin'],'https://osscsskfda.org','https://www.osscsskfda.org'],true)) fail(403,'ต้นทางคำขอไม่ถูกต้อง');
        if ($route==='setup'&&$method==='POST') {require_once __DIR__.'/install.php';$v=body(4096);reply(web_install($v->token??''));}
        if ($route==='health'&&$method==='GET') {
            try {state();reply(['ok'=>true]);} catch(\Throwable) {reply(['ok'=>false],503);}
        }
        $name=($c['secure_cookie']?'__Secure-':'').'gecc-'.substr(hash('sha256',$c['base_path']),0,12);
        $cookie=function(string $value,int $age=28800)use($c,$name):void {
            setcookie($name,$value,['expires'=>time()+$age,'path'=>$c['base_path'].'/','secure'=>(bool)$c['secure_cookie'],'httponly'=>true,'samesite'=>'Strict']);
        };
        $session=null;$sid=$_COOKIE[$name]??'';
        if (is_string($sid)&&preg_match('/^[a-f0-9]{64}$/D',$sid)) {
            $session=query('SELECT s.csrf,s.expires_at,a.* FROM gecc_sessions s JOIN gecc_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND a.active=1 AND s.expires_at>UTC_TIMESTAMP(3)',[hash('sha256',$sid)])->fetch()?:null;
            if ($session) {$session['team']=$session['team']===null?null:(int)$session['team'];$session['must_change']=(bool)$session['must_change'];}
        }
        $GLOBALS['actor']=$session;
        if ($route==='session'&&$method==='POST') {
            $v=body(4096);$username=is_string($v->username??null)?trim($v->username):'';
            if (length($username)>80) fail(401,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
            reserve_login($username);
            $a=query('SELECT * FROM gecc_accounts WHERE username=?',[$username])->fetch();
            // Constant-cost dummy verification avoids revealing whether a username exists.
            $hash=$a['password_hash']??'$argon2id$v=19$m=65536,t=4,p=1$MDEyMzQ1Njc4OWFiY2RlZg$Yz/ntmKQs05w9gV2AH9TMr4Z9eL5OMh4Qj6i3p0Xr5c';
            $valid=is_string($v->password??null)&&length($v->password)<=128&&password_verify($v->password,$hash);
            if (!$a||!$a['active']||!$valid) fail(401,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
            $token=bin2hex(random_bytes(32));$csrf=bin2hex(random_bytes(32));
            tx(function()use($sid,$token,$csrf,$a,$username){
                query('DELETE FROM gecc_sessions WHERE token_hash=? OR expires_at<UTC_TIMESTAMP(3)',[hash('sha256',(string)$sid)]);
                query('INSERT INTO gecc_sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR))',[hash('sha256',$token),$a['id'],$csrf]);
                query('DELETE FROM gecc_login_attempts WHERE key_hash=?',[hash('sha256',($_SERVER['REMOTE_ADDR']??'').':'.$username)]);
                audit($a['id'],'login','session');
            });
            $cookie($token);reply(['user'=>account_view($a),'csrf'=>$csrf]);
        }
        if ($route==='session'&&$method==='GET') reply(['user'=>$session?account_view($session):null,'csrf'=>$session['csrf']??null]);
        if ($modifying&&(!$session||!hash_equals($session['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??''))) fail($session?403:401,$session?'คำขอยืนยันตัวตนไม่ถูกต้อง':'กรุณาเข้าสู่ระบบอีกครั้ง');
        if ($route==='session'&&$method==='DELETE') {
            query('DELETE FROM gecc_sessions WHERE token_hash=?',[hash('sha256',$sid)]);$cookie('',-1);reply(['ok'=>true]);
        }
        if ($route==='password'&&$method==='POST') {
            $v=body(4096);
            if (!is_string($v->current??null)||!password_verify($v->current,$session['password_hash'])) fail(400,'รหัสผ่านปัจจุบันไม่ถูกต้อง');
            if (!password_valid($v->password??null)||$v->current===$v->password) fail(400,'ใช้รหัสผ่านใหม่ 12–128 ตัวอักษรที่ต่างจากเดิม');
            $hash=password_hash_value($v->password);
            tx(function()use($hash,$session){
                query('UPDATE gecc_accounts SET password_hash=?,must_change=0 WHERE id=?',[$hash,$session['id']]);
                query('DELETE FROM gecc_sessions WHERE account_id=?',[$session['id']]);audit($session['id'],'password-change','account');
            });
            $cookie('',-1);reply(['ok'=>true]);
        }
        if ($modifying&&!empty($session['must_change'])) fail(403,'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
        if ($route==='state'&&$method==='GET') {[$s,$r]=state();reply(result($s,$r,$session));}
        if ($route==='summary'&&$method==='GET') {[$s]=state();reply(summary($s));}
        if ($route==='state'&&$method==='PUT') {
            $v=body(8388608);
            reply(tx(function()use($v,$session){
                [$s,$r]=state(true);if (($v->revision??null)!==$r) fail(409,'มีข้อมูลใหม่จากผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
                $next=merge_state($s,$v->state??null,$session);
                if (!empty($v->state->isSample)) fail(400,'ไม่รับข้อมูลสาธิตในระบบจริง');
                foreach($s->units as $u) if (!find($next->units,fn($x)=>$x->id===$u->id)) {
                    query('DELETE FROM gecc_sessions WHERE account_id IN (SELECT id FROM gecc_accounts WHERE unit_id=?)',[$u->id]);
                    query('UPDATE gecc_accounts SET active=0 WHERE unit_id=?',[$u->id]);
                }
                file_checks($s,$next,$session);return save_state($next,$r,$session['id'],'save');
            }));
        }
        if (preg_match('~^workflow/([A-Za-z0-9_-]+)$~D',$route,$m)&&$method==='POST') {
            $v=body(8192);
            reply(tx(function()use($v,$session,$m){
                [$s,$r]=state(true);if (($v->revision??null)!==$r) fail(409,'ข้อมูลเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
                $next=transition($s,$m[1],(string)($v->action??''),$session,mb_substr((string)($v->note??''),0,4000),$v->sender??null);
                return save_state($next,$r,$session['id'],$v->action,$m[1]);
            }));
        }
        if (in_array($route,['import','import/preview'],true)&&$method==='POST') {
            if ($session['role']!=='coord') fail(403,'เฉพาะผู้ประสานงานนำเข้าข้อมูล');
            $v=body(8388608);
            reply(tx(function()use($v,$route,$session){
                [$s,$r]=state(true);if (($v->revision??null)!==$r) fail(409,'ข้อมูลเปลี่ยนแปลง กรุณาตรวจนำเข้าใหม่');
                $next=prepare_import($s,$v->state??null);$missing=[];
                foreach(references($next) as $f) {
                    $stored=query('SELECT unit_id FROM gecc_files WHERE id=?',[$f->id??''])->fetch();
                    if (!$stored||$stored['unit_id']!==$f->unitId) $missing[]=['id'=>$f->id,'unitId'=>$f->unitId];
                }
                if ($route==='import/preview') return ['revision'=>$r,'units'=>count($next->units),'assessments'=>count(get_object_vars($next->assess)),'defects'=>count($next->defects),'missing'=>$missing];
                if ($missing) fail(400,'ยังมีไฟล์แนบไม่ครบ กรุณาตรวจชุดสำรอง');
                return save_state($next,$r,$session['id'],'import');
            }));
        }
        if ($route==='admin/reset'&&$method==='POST') {
            if ($session['role']!=='coord') fail(403,'เฉพาะผู้ประสานงานจัดการข้อมูล');
            $v=body(4096);
            if (!in_array($v->mode??null,['assessments','official'],true)) fail(400,'คำสั่งไม่ถูกต้อง');
            reply(tx(function()use($v,$session){
                [$s,$r]=state(true);if (($v->revision??null)!==$r) fail(409,'ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่');
                $s->assess=(object)[];$s->defects=[];
                $s->nextUnitCode??=max([0,...array_map(fn($u)=>(int)($u->code??0),$s->units)])+1;
                if ($v->mode==='official') {
                    $official=decode(file_get_contents(__DIR__.'/data/seed.json'));$units=$s->units;
                    $s->units=$official->units;$s->teams=$official->teams;
                    foreach($s->units as $u) $u->code=find($units,fn($x)=>$x->id===$u->id)->code??str_pad((string)$s->nextUnitCode++,6,'0',STR_PAD_LEFT);
                }
                return save_state($s,$r,$session['id'],'reset-'.$v->mode);
            }));
        }
        if (preg_match('~^files/([A-Za-z0-9_-]{1,160})$~D',$route,$m)) {
            if (!$session) fail(401,'กรุณาเข้าสู่ระบบ');
            $id=$m[1];$file=$c['files'].DIRECTORY_SEPARATOR.$id;
            if ($method==='PUT') {
                $unit=$_SERVER['HTTP_X_UNIT_ID']??'';[$s]=state();
                if (!allowed($session,find($s->units,fn($u)=>$u->id===$unit))) fail(403,'ไม่มีสิทธิ์แนบไฟล์');
                if (($s->assess->$unit->wf->status??'')==='reviewed') fail(409,'ผลตรวจถูกล็อก');
                $bytes=body(10485760,true);$mime=file_type($bytes);
                if (!$mime) fail(400,'รับเฉพาะ PDF, JPEG, PNG หรือ WebP ที่ถูกต้อง ขนาดไม่เกิน 10 MB');
                $name=mb_substr(preg_replace('~[\x00-\x1f/\\\\]~','_',rawurldecode($_SERVER['HTTP_X_FILE_NAME']??$id)),0,200);
                if (!mb_check_encoding($name,'UTF-8')) fail(400,'ชื่อไฟล์ไม่ถูกต้อง');
                $fp=@fopen($file,'x+b');if (!$fp) fail(409,'รหัสไฟล์ซ้ำ กรุณาแนบไฟล์ใหม่');
                try {
                    if (fwrite($fp,$bytes)!==strlen($bytes)) fail(503,'บันทึกไฟล์ไม่สำเร็จ');
                    fflush($fp);fclose($fp);$fp=null;chmod($file,0600);
                    tx(function()use($id,$unit,$session,$name,$mime,$bytes){
                        [$locked]=state(true);
                        if (!allowed($session,find($locked->units,fn($u)=>$u->id===$unit))||($locked->assess->$unit->wf->status??'')==='reviewed') fail(409,'ข้อมูลเปลี่ยนแปลงหรือผลตรวจถูกล็อก');
                        query('INSERT INTO gecc_files(id,unit_id,account_id,name,mime,size,digest) VALUES(?,?,?,?,?,?,?)',[$id,$unit,$session['id'],$name,$mime,strlen($bytes),hash('sha256',$bytes)]);
                        audit($session['id'],'upload',$id);
                    });
                } catch(\Throwable $e) {if(is_resource($fp))fclose($fp);@unlink($file);throw $e;}
                reply(['id'=>$id,'name'=>$name,'type'=>$mime,'size'=>strlen($bytes)],201);
            }
            if ($method==='GET') {
                $f=query('SELECT * FROM gecc_files WHERE id=?',[$id])->fetch();[$s]=state();
                if (!$f||!allowed($session,find($s->units,fn($u)=>$u->id===$f['unit_id']))||!is_file($file)) fail(404,'ไม่พบไฟล์');
                header('Content-Type: '.$f['mime']);header('X-Content-Type-Options: nosniff');
                header("Content-Security-Policy: sandbox; default-src 'none'");
                header("Content-Disposition: inline; filename*=UTF-8''".rawurlencode($f['name']));
                header('Cache-Control: private, no-store');readfile($file);exit;
            }
        }
        if ($route==='accounts'&&($session['role']??'')==='coord') {
            if ($method==='GET') {
                $rows=query('SELECT * FROM gecc_accounts ORDER BY username')->fetchAll();
                reply(['accounts'=>array_map(fn($a)=>account_view($a)+['active'=>(bool)$a['active']],$rows)]);
            }
            if ($method==='POST') {
                $v=body(8192);[$s]=state();$role=$v->role??'';$unit=find($s->units,fn($u)=>$u->id===($v->unitId??null));
                $username=trim((string)($role==='mentee'?($unit->code??''):($v->username??'')));
                if (!in_array($role,['mentee','mentor','coord'],true)||!$username||length($username)>80||!is_string($v->name??null)||!trim($v->name)||length($v->name)>200
                    ||($role==='mentee'&&!$unit)||($role==='mentor'&&!find($s->teams,fn($t)=>$t->id===(int)($v->team??0)))) fail(400,'ข้อมูลบัญชีไม่ถูกต้อง');
                $hash=password_hash_value($v->password??null);$id=uid();
                tx(function()use($v,$role,$username,$unit,$hash,$id,$session){
                    query('INSERT INTO gecc_accounts(id,username,name,password_hash,role,unit_id,team) VALUES(?,?,?,?,?,?,?)',[$id,$username,trim($v->name),$hash,$role,$role==='mentee'?$unit->id:null,$role==='mentor'?(int)$v->team:null]);
                    audit($session['id'],'create-account',$id);
                });reply(['ok'=>true],201);
            }
        }
        if (preg_match('~^accounts/([A-Za-z0-9_-]+)$~D',$route,$m)&&$method==='PATCH'&&($session['role']??'')==='coord') {
            $v=body(4096);$id=$m[1];if ($id===$session['id']&&($v->active??null)===false) fail(400,'ปิดบัญชีตนเองไม่ได้');
            $hash=isset($v->password)?password_hash_value($v->password):null;
            tx(function()use($v,$id,$hash,$session){
                if (!query('SELECT id FROM gecc_accounts WHERE id=? FOR UPDATE',[$id])->fetch()) fail(404,'ไม่พบบัญชี');
                if (isset($v->active)&&is_bool($v->active)) query('UPDATE gecc_accounts SET active=? WHERE id=?',[(int)$v->active,$id]);
                if ($hash) query('UPDATE gecc_accounts SET password_hash=?,must_change=1 WHERE id=?',[$hash,$id]);
                query('DELETE FROM gecc_sessions WHERE account_id=?',[$id]);audit($session['id'],'update-account',$id);
            });reply(['ok'=>true]);
        }
        if ($route==='audit'&&$method==='GET'&&($session['role']??'')==='coord') {
            $events=query('SELECT action,resource,account_id,revision,created_at FROM gecc_audit ORDER BY created_at DESC LIMIT 100')->fetchAll();
            foreach($events as &$event) {
                $event['created_at']=(new \DateTimeImmutable($event['created_at'],new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
                $event['revision']=$event['revision']===null?null:(int)$event['revision'];
            }
            reply(['events'=>$events]);
        }
        fail($session?404:401,$session?'ไม่พบรายการ':'กรุณาเข้าสู่ระบบ');
    } catch(\Throwable $e) {
        $status=$e instanceof HttpError?$e->status:($e instanceof \PDOException&&$e->getCode()==='23000'?409:500);
        if ($status===500) error_log('GECC request failed: '.get_class($e));
        reply(['error'=>$status===500?'ระบบไม่สามารถทำรายการได้ กรุณาติดต่อผู้ดูแล':($e instanceof HttpError?$e->getMessage():'ข้อมูลนี้มีอยู่แล้ว')],$status);
    }
}
