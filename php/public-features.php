<?php
declare(strict_types=1);
namespace GECC;

// Explicit public projection: never return assessment text, evidence or reviewer notes.
function public_units(object $s): array {
    return array_map(function($u)use($s){
        $a=$s->assess->{$u->id}??null;$sub=sub_of($a);
        $complete=$sub['phys']==='done'&&$sub['qual']==='done'&&$sub['out']==='done';
        $c=$complete?calc($a):null;
        return ['id'=>$u->id,'name'=>$u->name,'team'=>$u->team,'submission'=>$complete?'done':(count(array_filter($sub,fn($v)=>$v!=='none'))?'prog':'none'),
            'criteria'=>$sub,'readiness'=>ready_of($a)['st'],'workflow'=>$a->wf->status??'draft',
            'physical'=>$a->phys??array_fill(0,15,null),'quality'=>array_map(fn($q)=>$q->subs??[], $a->qc??[]),
            'narrative'=>array_map(fn($n)=>isset($n->score),$a->narr??[]),
            'status'=>!$complete?'none':(!$c['physComplete']||$c['total']<240?'risk':(count(array_filter($s->defects,fn($d)=>$d->unitId===$u->id&&$d->status!=='closed'))?'fix':'pass')),
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
function validate_feature_content(object $content):void {
        foreach(['albums','videos','mentorAdvisors'] as $k)if(isset($content->$k)&&(!is_array($content->$k)||count($content->$k)>200))fail(400,'จำนวนเนื้อหาไม่ถูกต้อง');
        foreach($content->albums??[] as $a){
            if(!is_string($a->title??null)||(($a->date??'')===''||!date_value($a->date))||!is_array($a->images??null)||count($a->images)>100||!in_array($a->status??null,['draft','published'],true))fail(400,'ข้อมูลอัลบั้มไม่ถูกต้อง');
            foreach($a->images as $im)if(!is_string($im->src??null)||!preg_match('~^(assets/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)|api/index\.php\?route=public/media/[a-f0-9]{32})$~D',$im->src)||str_contains($im->src,'..'))fail(400,'รูปอัลบั้มไม่ถูกต้อง');
        }
        foreach($content->videos??[] as $vdo){
            if(!is_string($vdo->title??null)||!is_string($vdo->url??null))fail(400,'ชื่อหรือลิงก์วิดีโอไม่ถูกต้อง');
            if(!in_array($vdo->status??null,['draft','published'],true)||!in_array($vdo->category??null,['physical','highlight','activity'],true))fail(400,'หมวดวิดีโอไม่ถูกต้อง');
            if(!empty($vdo->url)){$u=parse_url($vdo->url);if(($u['scheme']??'')!=='https'||!in_array($u['host']??'',['youtu.be','www.youtube.com','youtube.com','drive.google.com'],true)||isset($u['user'])||isset($u['pass']))fail(400,'ใช้วิดีโอ YouTube หรือ Google Drive เท่านั้น');}
        }

}
function feature_routes(string $route,string $method,?array $actor): void {
    if($route==='public/units'&&$method==='GET'){[$s]=state();reply(['units'=>public_units($s)]);}
    if($route==='public/content'&&$method==='GET'){[$s]=state();reply(public_content($s));}
    if($route==='library') {
        $c=config();$name='gecc_library';
        $key=$c['library_password_hash']??'';
        $token=$_COOKIE[$name]??'';$parts=explode('.',$token);
        $valid=count($parts)===2&&ctype_digit($parts[0])&&(int)$parts[0]>time()&&$key!==''&&hash_equals(hash_hmac('sha256',$parts[0],$key),$parts[1]);
        if($method==='POST'){
            $v=body(4096);reserve_login('library');
            if(!$key||!is_string($v->password??null)||strlen($v->password)>512||!password_verify($v->password,$key))fail(401,'รหัสผ่านไม่ถูกต้อง');
            $expires=(string)(time()+28800);$value=$expires.'.'.hash_hmac('sha256',$expires,$key);
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
}
