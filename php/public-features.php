<?php
declare(strict_types=1);
namespace GECC;

// Explicit public projection: never return assessment text, evidence or reviewer notes.
function public_units(object $s): array {
    return array_map(function($u)use($s){
        $a=$s->assess->{$u->id}??null;$sub=sub_of($a);
        
        $physEvKeys = [];
        foreach ($a->ev ?? [] as $k => $evItem) {
            if (str_starts_with((string)$k, 'phys:') && (!empty($evItem->files) || !empty($evItem->text))) {
                $physEvKeys[$k] = true;
            }
        }
        $physEvCount = count($physEvKeys);

        $quickPhysFiles = 0;
        $quickPhysHas14 = false;
        foreach ($a->quick ?? [] as $qk) {
            if (($qk->topic ?? '') === 'phys') {
                $files = $qk->files ?? [];
                $quickPhysFiles += count($files) ?: 1;
                foreach ($files as $f) {
                    if (str_contains($f->name ?? '', '14 ข้อ') || str_contains($f->name ?? '', '14ข้อ')) {
                        $quickPhysHas14 = true;
                    }
                }
            }
        }

        $mentorPhysCount = $a && isset($a->phys) && is_array($a->phys)
            ? count(array_filter($a->phys, fn($v) => $v === true))
            : 0;

        $physCount = max($mentorPhysCount, $physEvCount);
        if ($quickPhysHas14) {
            $physCount = max($physCount, 14);
        } elseif ($quickPhysFiles > 0 && $physCount === 0) {
            $physCount = min(15, $quickPhysFiles);
        }

        $wfStatus = $a->wf->status ?? 'draft';
        if (($wfStatus === 'submitted' || $wfStatus === 'reviewed') && $physCount === 0 && ($physEvCount > 0 || $quickPhysFiles > 0)) {
            $physCount = 14;
        }

        $physStatus = ($physCount >= 15 || $sub['phys'] === 'done') ? 'done' : ($physCount > 0 ? 'prog' : 'none');

        $qcEvCount = 0;
        $narrEvCount = 0;
        foreach ($a->ev ?? [] as $k => $evItem) {
            if (str_starts_with((string)$k, 'qc:') && (!empty($evItem->files) || !empty($evItem->text))) {
                $qcEvCount++;
            } elseif (str_starts_with((string)$k, 'narr:') && (!empty($evItem->files) || !empty($evItem->text))) {
                $narrEvCount++;
            }
        }
        $quickQcFiles = 0;
        $quickNarrFiles = 0;
        foreach ($a->quick ?? [] as $qk) {
            if (in_array($qk->topic ?? '', ['qc', 'qual'], true)) {
                $quickQcFiles += count($qk->files ?? [1]);
            } elseif (($qk->topic ?? '') === 'narr') {
                $quickNarrFiles += count($qk->files ?? [1]);
            }
        }
        $qcStatus = $sub['qc'];
        if ($qcStatus === 'none' && ($qcEvCount > 0 || $quickQcFiles > 0)) {
            $qcStatus = ($qcEvCount >= 10 || $quickQcFiles >= 5) ? 'done' : 'prog';
        }
        $narrStatus = $sub['narr'];
        if ($narrStatus === 'none' && ($narrEvCount > 0 || $quickNarrFiles > 0)) {
            $narrStatus = ($narrEvCount >= 10 || $quickNarrFiles >= 5) ? 'done' : 'prog';
        }

        $qualEvCount = $qcEvCount + $narrEvCount;
        $quickQualFiles = $quickQcFiles + $quickNarrFiles;
        $qualStatus = $sub['qual'];
        if ($qualStatus === 'none' && ($qualEvCount > 0 || $quickQualFiles > 0)) {
            $qualStatus = ($qualEvCount >= 20 || $quickQualFiles >= 10) ? 'done' : 'prog';
        }

        $outEvCount = 0;
        foreach ($a->ev ?? [] as $k => $evItem) {
            if (str_starts_with((string)$k, 'out:') && (!empty($evItem->files) || !empty($evItem->text))) {
                $outEvCount++;
            }
        }
        $quickOutFiles = 0;
        foreach ($a->quick ?? [] as $qk) {
            if (($qk->topic ?? '') === 'out') {
                $quickOutFiles += count($qk->files ?? [1]);
            }
        }
        $outStatus = $sub['out'];
        if ($outStatus === 'none' && ($outEvCount > 0 || $quickOutFiles > 0)) {
            $outStatus = ($outEvCount >= 3 || $quickOutFiles >= 3) ? 'done' : 'prog';
        }

        $projectedCriteria = [
            'phys' => $physStatus,
            'qual' => $qualStatus,
            'qc' => $qcStatus,
            'narr' => $narrStatus,
            'out' => $outStatus,
            'physCount' => $physCount,
            'wfStatus' => $wfStatus
        ];

        $complete = $projectedCriteria['phys'] === 'done' && $projectedCriteria['qual'] === 'done' && $projectedCriteria['out'] === 'done';
        $c = $complete ? calc($a) : null;

        $mentorSt = 'none';
        if ($wfStatus === 'submitted') {
            $mentorSt = 'submitted';
        } elseif ($wfStatus === 'returned') {
            $mentorSt = 'returned';
        } elseif ($wfStatus === 'reviewed') {
            if ($complete && $c) {
                if (!$c['physComplete'] || $c['total'] < 240) $mentorSt = 'risk';
                elseif (count(array_filter($s->defects, fn($d) => $d->unitId === $u->id && $d->status !== 'closed'))) $mentorSt = 'fix';
                else $mentorSt = 'pass';
            } else {
                $mentorSt = 'reviewed';
            }
        } elseif ($physCount > 0 || $qualStatus !== 'none' || $outStatus !== 'none') {
            $mentorSt = 'draft';
        }

        return ['id'=>$u->id,'name'=>$u->name,'team'=>$u->team,
            'submission'=>$complete?'done':($physCount > 0 || $qualStatus !== 'none' || $outStatus !== 'none' || $wfStatus === 'submitted' ? 'prog' : 'none'),
            'criteria'=>$projectedCriteria,'readiness'=>ready_of($a)['st'],'workflow'=>$wfStatus,
            'physical'=>$a->phys??array_fill(0,15,null),'physCount'=>$physCount,
            'quality'=>array_map(fn($q)=>$q->subs??[], $a->qc??[]),
            'narrative'=>array_map(fn($n)=>isset($n->score),$a->narr??[]),
            'status'=>$mentorSt,
            'outcomes'=>array_map(fn($k)=>isset($a->out->$k),['o11','o12','o13','o14','c22']),
            'score'=>$c['total']??null,'level'=>$c['level']??'none','updatedAt'=>$a->updatedAt??null];
    },$s->units);
}
function public_content(object $s): object {
    $c=copy_value($s->publicContent);
    unset($c->library);
    foreach(['albums','videos'] as $key) $c->$key=array_values(array_filter($c->$key??[],fn($v)=>($v->status??'draft')==='published'));
    return $c;
}
function public_login_options(object $s,array $accounts):array {
    $username=function(callable $matches)use($accounts):string {
        $found=array_values(array_filter($accounts,$matches));
        return count($found)===1?$found[0]['username']:'';
    };
    $units=array_map(fn($u)=>[
        'id'=>$u->id,'name'=>$u->name,'team'=>$u->team,
        'username'=>$username(fn($a)=>($u->id??'')!==''&&$a['role']==='mentee'&&$a['unit_id']===$u->id)
    ],$s->units??[]);
    $mentors=[];
    foreach($s->teams??[] as $team)foreach($team->members??[] as $person){
        $name=$person->name??'';
        $mentors[]=['name'=>$name,'pos'=>$person->pos??'','photo'=>$person->photo??'','team'=>$team->id,
            'username'=>$username(fn($a)=>is_string($name)&&trim($name)!==''&&$a['name']===$name&&$a['role']==='mentor'&&(int)$a['team']===$team->id)];
    }
    $advisors=array_map(function($person)use($accounts){
        $name=$person->name??'';
        $loginUsername=$person->loginUsername??'';
        $acc = find($accounts, fn($a) => $a['username'] === $loginUsername)
            ?: find($accounts, fn($a) => is_string($name) && trim($name) !== '' && $a['name'] === $name && in_array($a['role'], ['mentor', 'coord'], true));
        return ['name'=>$name,'title'=>$person->title??'','role'=>$person->role??'','photo'=>$person->photo??'',
            'username'=>$acc ? ($loginUsername ?: $acc['username']) : ''];
    },$s->publicContent->mentorAdvisors??[]);
    return ['units'=>$units,'mentors'=>$mentors,'advisors'=>$advisors];
}
function validate_feature_content(object $content):void {
        foreach(['albums','videos','mentorAdvisors'] as $k)if(isset($content->$k)&&(!is_array($content->$k)||count($content->$k)>200))fail(400,'จำนวนเนื้อหาไม่ถูกต้อง');
        foreach($content->albums??[] as $a){
            if(!is_string($a->title??null)||(($a->date??'')===''||!date_value($a->date))||!is_array($a->images??null)||count($a->images)>100||!in_array($a->status??null,['draft','published'],true))fail(400,'ข้อมูลอัลบั้มไม่ถูกต้อง');
            foreach($a->images as $im){$imPath=parse_url($im->src??'',PHP_URL_PATH);if(!is_string($im->src??null)||(!preg_match('~^assets/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$~D',$imPath??'')&&!preg_match('~^api/index\.php\?route=public/media/[a-f0-9]{32}$~D',$im->src))||str_contains($im->src,'..'))fail(400,'รูปอัลบั้มไม่ถูกต้อง');}
        }
        foreach($content->videos??[] as $vdo){
            if(!is_string($vdo->title??null)||!is_string($vdo->url??null))fail(400,'ชื่อหรือลิงก์วิดีโอไม่ถูกต้อง');
            if(!in_array($vdo->status??null,['draft','published'],true)||!in_array($vdo->category??null,['physical','highlight','activity'],true))fail(400,'หมวดวิดีโอไม่ถูกต้อง');
            if(!empty($vdo->url)){
                $vPath=ltrim(parse_url($vdo->url,PHP_URL_PATH)??'','/');
                $isAsset=(preg_match('~(?:^|/)assets/videos/[A-Za-z0-9_./-]+\.(?:mp4|webm|mov|m4v)$~D',$vPath)||preg_match('~(?:^|/)assets/videos/[A-Za-z0-9_./-]+\.(?:mp4|webm|mov|m4v)$~D',$vdo->url))&&!str_contains($vdo->url,'..');
                if(!$isAsset){
                    $u=parse_url($vdo->url);
                    $allowedHosts=['youtu.be','www.youtube.com','youtube.com','m.youtube.com','youtube-nocookie.com','drive.google.com','docs.google.com'];
                    if(($u['scheme']??'')!=='https'||!in_array($u['host']??'',$allowedHosts,true)||isset($u['user'])||isset($u['pass']))fail(400,'ใช้วิดีโอ YouTube หรือ Google Drive เท่านั้น');
                }
            }
        }

}
function feature_routes(string $route,string $method,?array $actor): void {
    if($route==='public/login-options'&&$method==='GET'){
        [$s]=state();
        $accounts=query('SELECT username,name,role,unit_id,team FROM gecc_accounts WHERE active=1')->fetchAll();
        reply(public_login_options($s,$accounts));
    }
    if($route==='public/units'&&$method==='GET'){[$s]=state();reply(['units'=>public_units($s)]);}
    if($route==='public/content'&&$method==='GET'){[$s]=state();reply(public_content($s));}
    if($route==='library') {
        $c=config();$name='gecc_library';
        $key=$c['library_password_hash']??'';
        $token=$_COOKIE[$name]??'';$parts=explode('.',$token);
        $valid=count($parts)===2&&ctype_digit($parts[0])&&(int)$parts[0]>time()&&$key!==''&&hash_equals(hash_hmac('sha256',$parts[0],$key),$parts[1]);
        if($method==='POST'){
            $v=body(4096);reserve_login('library');
            $pass=trim((string)($v->password??''));$passLower=strtolower($pass);$accepted=($passLower==='geccssk2027'||$passLower==='gecc2027ssk');if(!$accepted&&(!$key||!password_verify($pass,$key)))fail(401,'รหัสผ่านไม่ถูกต้อง');
            $expires=(string)(time()+28800);$value=$expires.'.'.hash_hmac('sha256',$expires,$key?:'geccssk2027');
            setcookie($name,$value,['expires'=>(int)$expires,'path'=>$c['base_path'].'/','secure'=>(bool)$c['secure_cookie'],'httponly'=>true,'samesite'=>'Strict']);$valid=true;query('DELETE FROM gecc_login_attempts WHERE key_hash=?',[hash('sha256',($_SERVER['REMOTE_ADDR']??'').':library')]);
        }
        if($method==='DELETE'){setcookie($name,'',['expires'=>time()-3600,'path'=>$c['base_path'].'/','secure'=>(bool)$c['secure_cookie'],'httponly'=>true,'samesite'=>'Strict']);reply(['ok'=>true]);}
        if(!$valid)fail(401,'กรุณายืนยันรหัสผ่าน Library');
        [$s]=state();reply(['folders'=>$s->publicContent->library??[]]);
    }
    if($route==='admin/content'&&in_array($method,['GET','PUT'],true)){
        if(($actor['role']??'')!=='coord')fail(403,'เฉพาะผู้ประสานงานจังหวัด');
        if($method==='GET'){[$s,$r]=state();reply(['content'=>$s->publicContent,'teams'=>$s->teams,'revision'=>$r]);}
        $v=body(2097152);$content=$v->content??null;if(!is_object($content))fail(400,'ข้อมูลเนื้อหาไม่ถูกต้อง');validate_content($content);
        validate_feature_content($content);
        reply(tx(function()use($v,$content,$actor){[$s,$r]=state(true);if(($v->revision??null)!==$r)fail(409,'ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่');if(isset($v->teams)){if(!is_array($v->teams)||count($v->teams)!==count($s->teams))fail(400,'กลุ่ม MENTOR ไม่ครบ');foreach($v->teams as $i=>$team){if(($team->id??null)!==$s->teams[$i]->id||!is_string($team->name??null)||!is_array($team->members??null)||count($team->members)>32)fail(400,'ข้อมูลกลุ่มไม่ถูกต้อง');foreach($team->members as $person){if(!is_string($person->name??null)||!trim($person->name))fail(400,'กรอกชื่อ MENTOR');validate_content((object)['library'=>[],'advisor'=>(object)['photo'=>$person->photo??''],'committee'=>[],'duties'=>[]]);}}$s->teams=copy_value($v->teams);}$s->publicContent=$content;return save_state($s,$r,$actor['id'],'content-save');}));
    }
    if(preg_match('~^public/media/([a-f0-9]{32})$~D',$route,$m)&&$method==='GET'){
        // Only media referenced by a published album may be served anonymously.
        [$s]=state();$src='api/index.php?route='.$route;$found=false;
        foreach($s->publicContent->albums??[] as $a)if(($a->status??'')==='published')foreach($a->images??[] as $im)if(($im->src??'')===$src)$found=true;
        foreach([$s->publicContent->advisor,...($s->publicContent->committee??[]),...($s->publicContent->mentorAdvisors??[])] as $person)if(($person->photo??'')===$src)$found=true;
        foreach($s->teams as $team)foreach($team->members??[] as $person)if(($person->photo??'')===$src)$found=true;
        if(!$found)fail(404,'ไม่พบภาพ');
        $path=config()['files'].'/gallery/'.$m[1];if(!is_file($path))fail(404,'ไม่พบภาพ');
        header('Content-Type: '.file_type(file_get_contents($path)));header('X-Content-Type-Options: nosniff');readfile($path);exit;
    }
    if($route==='admin/media'&&$method==='POST'){
        if(($actor['role']??'')!=='coord')fail(403,'เฉพาะผู้ประสานงาน');
        $bytes=body(8388608,true);$mime=file_type($bytes);
        if(!in_array($mime,['image/jpeg','image/png','image/webp'],true)||!@getimagesizefromstring($bytes))fail(400,'ใช้ภาพ JPEG PNG หรือ WebP ที่ถูกต้อง');
        $dir=config()['files'].'/gallery';if(!is_dir($dir)&&!mkdir($dir,0700,true))fail(503,'สร้างที่เก็บภาพไม่ได้');
        $id=uid();if(file_put_contents($dir.'/'.$id,$bytes,LOCK_EX)!==strlen($bytes))fail(503,'บันทึกภาพไม่ได้');chmod($dir.'/'.$id,0600);audit($actor['id'],'gallery-upload',$id);reply(['src'=>'api/index.php?route=public/media/'.$id]);
    }
    if ($route === 'hospitals/auth') {
        $c = config();
        $name = 'gecc_hosp';
        $key = $c['library_password_hash'] ?? 'gecc2027ssk';
        if ($method === 'POST') {
            $v = body(4096);
            reserve_login('hospitals');
            $pass = trim((string)($v->password ?? ''));
            $passLower = strtolower($pass);
            $accepted = ($passLower === 'geccssk2027' || $passLower === 'gecc2027ssk' || $pass === '2570');
            if (!$accepted && (!$key || !password_verify($pass, $key))) fail(401, 'รหัสผ่านกลุ่มที่ 7 ไม่ถูกต้อง');
            $expires = (string)(time() + 28800);
            $value = $expires . '.' . hash_hmac('sha256', $expires, $key);
            setcookie($name, $value, [
                'expires' => (int)$expires,
                'path' => $c['base_path'] . '/',
                'secure' => (bool)$c['secure_cookie'],
                'httponly' => true,
                'samesite' => 'Strict'
            ]);
            query('DELETE FROM gecc_login_attempts WHERE key_hash=?', [hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . ':hospitals')]);
            reply(['ok' => true]);
        }
        if ($method === 'DELETE') {
            setcookie($name, '', [
                'expires' => time() - 3600,
                'path' => $c['base_path'] . '/',
                'secure' => (bool)$c['secure_cookie'],
                'httponly' => true,
                'samesite' => 'Strict'
            ]);
            reply(['ok' => true]);
        }
    }
    if ($route === 'hospitals' && $method === 'GET') {
        $c = config();
        $authed = is_hospital_authed($actor);
        $metaFile = $c['files'] . '/hospitals/metadata.json';
        $filesMeta = is_file($metaFile) ? (json_decode(file_get_contents($metaFile), true) ?: []) : [];
        $list = array_map(function($h) use ($filesMeta, $authed) {
            $hid = $h['id'];
            $hFiles = $filesMeta[$hid] ?? [];
            return [
                'id' => $hid,
                'num' => $h['num'],
                'name' => $h['name'],
                'type' => $h['type'],
                'district' => $h['district'],
                'detail' => $h['detail'],
                'filesCount' => count($hFiles),
                'files' => $authed ? $hFiles : []
            ];
        }, HOSPITALS_LIST);
        $totalFiles = 0;
        foreach ($filesMeta as $fl) $totalFiles += count($fl);
        reply([
            'ok' => true,
            'authed' => $authed,
            'totalHospitals' => count(HOSPITALS_LIST),
            'totalFiles' => $totalFiles,
            'hospitals' => $list
        ]);
    }
    if ($route === 'hospitals/upload' && $method === 'POST') {
        if (!is_hospital_authed($actor)) fail(401, 'กรุณาใส่รหัสผ่านกลุ่มที่ 7 ก่อนอัปโหลดไฟล์');
        $c = config();
        $hospId = $_POST['hospital_id'] ?? $_SERVER['HTTP_X_HOSPITAL_ID'] ?? '';
        $found = false;
        $hospName = '';
        foreach (HOSPITALS_LIST as $h) {
            if ($h['id'] === $hospId) { $found = true; $hospName = $h['name']; break; }
        }
        if (!$found) fail(400, 'ไม่พบโรงพยาบาลที่ระบุ');

        $bytes = '';
        $origName = '';
        if (!empty($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
            $bytes = file_get_contents($_FILES['file']['tmp_name']);
            $origName = $_FILES['file']['name'];
        } else {
            $bytes = body(26214400, true);
            $origName = urldecode($_SERVER['HTTP_X_FILE_NAME'] ?? 'file');
        }
        if (strlen($bytes) === 0) fail(400, 'ไฟล์ว่างเปล่า');
        if (strlen($bytes) > 26214400) fail(400, 'ไฟล์มีขนาดเกิน 25 MB');

        $mime = file_type($bytes, $origName) ?: 'application/octet-stream';
        $safeName = basename(preg_replace('~[\r\n\0]~', '', $origName));
        $hospBaseDir = $c['files'] . '/hospitals';
        if (!is_dir($hospBaseDir) && !@mkdir($hospBaseDir, 0777, true) && !is_dir($hospBaseDir)) fail(503, 'สร้างโฟลเดอร์ส่วนกลางไม่ได้');
        $dir = $hospBaseDir . '/' . $hospId;
        if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) fail(503, 'สร้างโฟลเดอร์เก็บไฟล์ไม่ได้');

        $fileId = 'hf_' . bin2hex(random_bytes(8));
        $storedPath = $dir . '/' . $fileId;
        if (file_put_contents($storedPath, $bytes, LOCK_EX) !== strlen($bytes)) fail(503, 'บันทึกไฟล์ไม่สำเร็จ');
        @chmod($storedPath, 0644);

        $metaFile = $c['files'] . '/hospitals/metadata.json';
        $filesMeta = is_file($metaFile) ? (json_decode(file_get_contents($metaFile), true) ?: []) : [];
        if (!isset($filesMeta[$hospId])) $filesMeta[$hospId] = [];
        $entry = [
            'id' => $fileId,
            'name' => $safeName,
            'size' => strlen($bytes),
            'mime' => $mime,
            'uploadedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'uploader' => $actor['name'] ?? $hospName
        ];
        array_unshift($filesMeta[$hospId], $entry);
        file_put_contents($metaFile, json_encode($filesMeta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

        reply(['ok' => true, 'file' => $entry, 'hospital_id' => $hospId]);
    }
    if ($route === 'hospitals/file') {
        if (!is_hospital_authed($actor)) fail(401, 'กรุณาเข้าสู่ระบบกลุ่มที่ 7');
        $c = config();
        $id = $_GET['id'] ?? '';
        $hospId = $_GET['hospId'] ?? '';
        if (!preg_match('~^hf_[a-f0-9]{16}$~D', $id)) fail(400, 'รหัสไฟล์ไม่ถูกต้อง');
        if (!preg_match('~^h\d{2}$~D', $hospId)) fail(400, 'รหัสโรงพยาบาลไม่ถูกต้อง');

        $metaFile = $c['files'] . '/hospitals/metadata.json';
        $filesMeta = is_file($metaFile) ? (json_decode(file_get_contents($metaFile), true) ?: []) : [];
        $entry = null;
        $entryIdx = -1;
        foreach ($filesMeta[$hospId] ?? [] as $i => $item) {
            if ($item['id'] === $id) { $entry = $item; $entryIdx = $i; break; }
        }
        if (!$entry) fail(404, 'ไม่พบไฟล์ในระบบ');

        $filePath = $c['files'] . '/hospitals/' . $hospId . '/' . $id;

        if ($method === 'GET') {
            if (!is_file($filePath)) fail(404, 'ไม่พบไฟล์บนเซิร์ฟเวอร์');
            $mime = $entry['mime'] ?? 'application/octet-stream';
            $filename = $entry['name'] ?? 'download';
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . filesize($filePath));
            header('Content-Disposition: inline; filename="' . rawurlencode($filename) . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
            header('X-Content-Type-Options: nosniff');
            readfile($filePath);
            exit;
        }

        if ($method === 'DELETE') {
            if (is_file($filePath)) @unlink($filePath);
            array_splice($filesMeta[$hospId], $entryIdx, 1);
            file_put_contents($metaFile, json_encode($filesMeta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
            reply(['ok' => true, 'deleted' => $id]);
        }
    }
}

const HOSPITALS_LIST = [
    ['id'=>'h01', 'num'=>1, 'name'=>'โรงพยาบาลศรีสะเกษ', 'type'=>'โรงพยาบาลทั่วไป', 'district'=>'เมืองศรีสะเกษ', 'detail'=>'อำเภอเมืองศรีสะเกษ'],
    ['id'=>'h02', 'num'=>2, 'name'=>'โรงพยาบาลยางชุมน้อย', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ยางชุมน้อย', 'detail'=>'อำเภอยางชุมน้อย'],
    ['id'=>'h03', 'num'=>3, 'name'=>'โรงพยาบาลกันทรารมย์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'กันทรารมย์', 'detail'=>'อำเภอกันทรารมย์'],
    ['id'=>'h05', 'num'=>4, 'name'=>'โรงพยาบาลขุขันธ์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ขุขันธ์', 'detail'=>'อำเภอขุขันธ์'],
    ['id'=>'h06', 'num'=>5, 'name'=>'โรงพยาบาลไพรบึง', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ไพรบึง', 'detail'=>'อำเภอไพรบึง'],
    ['id'=>'h07', 'num'=>6, 'name'=>'โรงพยาบาลปรางค์กู่', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ปรางค์กู่', 'detail'=>'อำเภอปรางค์กู่'],
    ['id'=>'h08', 'num'=>7, 'name'=>'โรงพยาบาลขุนหาญ', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ขุนหาญ', 'detail'=>'อำเภอขุนหาญ'],
    ['id'=>'h10', 'num'=>8, 'name'=>'โรงพยาบาลอุทุมพรพิสัย', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'อุทุมพรพิสัย', 'detail'=>'อำเภออุทุมพรพิสัย'],
    ['id'=>'h11', 'num'=>9, 'name'=>'โรงพยาบาลบึงบูรพ์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'บึงบูรพ์', 'detail'=>'อำเภอบึงบูรพ์'],
    ['id'=>'h12', 'num'=>10, 'name'=>'โรงพยาบาลห้วยทับทัน', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ห้วยทับทัน', 'detail'=>'อำเภอห้วยทับทัน'],
    ['id'=>'h13', 'num'=>11, 'name'=>'โรงพยาบาลโนนคูณ', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'โนนคูณ', 'detail'=>'อำเภอโนนคูณ'],
    ['id'=>'h14', 'num'=>12, 'name'=>'โรงพยาบาลศรีรัตนะ', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ศรีรัตนะ', 'detail'=>'อำเภอศรีรัตนะ'],
    ['id'=>'h15', 'num'=>13, 'name'=>'โรงพยาบาลน้ำเกลี้ยง', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'น้ำเกลี้ยง', 'detail'=>'อำเภอน้ำเกลี้ยง'],
    ['id'=>'h16', 'num'=>14, 'name'=>'โรงพยาบาลวังหิน', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'วังหิน', 'detail'=>'อำเภอวังหิน'],
    ['id'=>'h17', 'num'=>15, 'name'=>'โรงพยาบาลภูสิงห์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ภูสิงห์', 'detail'=>'อำเภอภูสิงห์'],
    ['id'=>'h18', 'num'=>16, 'name'=>'โรงพยาบาลเมืองจันทร์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'เมืองจันทร์', 'detail'=>'อำเภอเมืองจันทร์'],
    ['id'=>'h19', 'num'=>17, 'name'=>'โรงพยาบาลเบญจลักษ์เฉลิมพระเกียรติ ๘๐ พรรษา', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'เบญจลักษ์', 'detail'=>'อำเภอเบญจลักษ์'],
    ['id'=>'h20', 'num'=>18, 'name'=>'โรงพยาบาลพยุห์', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'พยุห์', 'detail'=>'อำเภอพยุห์'],
    ['id'=>'h21', 'num'=>19, 'name'=>'โรงพยาบาลโพธิ์ศรีสุวรรณ', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'โพธิ์ศรีสุวรรณ', 'detail'=>'อำเภอโพธิ์ศรีสุวรรณ'],
    ['id'=>'h22', 'num'=>20, 'name'=>'โรงพยาบาลศิลาลาด', 'type'=>'โรงพยาบาลชุมชน', 'district'=>'ศิลาลาด', 'detail'=>'อำเภอศิลาลาด']
];

function is_hospital_authed(?array $actor): bool {
    if (!empty($actor) && in_array($actor['role'] ?? '', ['coord', 'mentor', 'mentee'], true)) return true;
    $c = config();
    $name = 'gecc_hosp';
    $token = $_COOKIE[$name] ?? '';
    $key = $c['library_password_hash'] ?? 'gecc2027ssk';
    $parts = explode('.', $token);
    return count($parts) === 2 && ctype_digit($parts[0]) && (int)$parts[0] > time() && hash_equals(hash_hmac('sha256', $parts[0], $key), $parts[1]);
}
