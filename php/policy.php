<?php
declare(strict_types=1);
namespace GECC;
function valid_id(mixed $v): bool { return is_string($v) && preg_match('/^[A-Za-z0-9_-]{1,160}$/D',$v)===1; }
function date_value(mixed $v): bool {
    if ($v==='') return true;
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$v)) return false;
    [$y,$m,$d]=array_map('intval',explode('-',$v)); return checkdate($m,$d,$y);
}
function find(array $list, callable $test): mixed { foreach ($list as $item) if ($test($item)) return $item; return null; }
function same(mixed $a, mixed $b): bool {
    if (is_object($a) && is_object($b)) {
        $ak=array_keys(get_object_vars($a)); $bk=array_keys(get_object_vars($b)); sort($ak);sort($bk);
        if ($ak!==$bk) return false;
        foreach ($ak as $k) if (!same($a->$k,$b->$k)) return false; return true;
    }
    if (is_array($a) && is_array($b)) {
        if (count($a)!==count($b)) return false;
        foreach ($a as $i=>$v) if (!array_key_exists($i,$b) || !same($v,$b[$i])) return false; return true;
    }
    if ((is_int($a)||is_float($a)) && (is_int($b)||is_float($b))) return $a == $b;
    return $a === $b;
}
function allowed(?array $a, ?object $u): bool {
    return $a && $u && ($a['role']==='coord' || ($a['role']==='mentor' && $a['team']!==null && ((int)$a['team']===0 || (int)$a['team']===$u->team)) || ($a['role']==='mentee' && $a['unit_id']===$u->id));
}
function project(object $s, ?array $a): object {
    $d=copy_value($s); unset($d->pins,$d->demoStat,$d->mentorRosterVersion);
    if (($a['role']??'')!=='coord') { $d->publicContent=public_content($s); }
    if (!$a) return (object)['v'=>$d->v,'fy'=>$d->fy,'isSample'=>false,
        'teams'=>array_map(fn($t)=>(object)array_intersect_key(get_object_vars($t),array_flip(['id','name','photo','members'])),$d->teams),
        'mentorCoordinators'=>$d->mentorCoordinators??[], 'cal'=>$d->cal, 'publicContent'=>$d->publicContent,
        'units'=>[], 'assess'=>(object)[], 'defects'=>[]];
    $d->units=array_values(array_filter($d->units,fn($u)=>allowed($a,$u)));
    $ids=array_map(fn($u)=>$u->id,$d->units);
    foreach ($d->assess as $id=>$v) if (!in_array($id,$ids,true)) unset($d->assess->$id);
    $d->defects=array_values(array_filter($d->defects,fn($v)=>in_array($v->unitId,$ids,true)));
    return $d;
}
function validate_content(?object $c): void {
    if (!$c) return;
    if (!is_array($c->library??null)||!is_array($c->committee??null)||!is_array($c->duties??null)||!is_object($c->advisor??null)) fail(400,'ข้อมูลเผยแพร่ไม่ครบ');
    $safe=function($v,$image=false) {
        if (!$v && $image) return;
        if (!is_string($v)||strlen($v)>8192) fail(400,'ลิงก์ไม่ถูกต้อง');
        if ($image && preg_match('~^api/index\.php\?route=public/media/[a-f0-9]{32}$~D',$v)) return;
        if ($image && preg_match('~^assets/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$~D',$v) && !str_contains($v,'..')) return;
        $u=parse_url($v);
        if (!$u || ($u['scheme']??'')!=='https' || empty($u['host']) || isset($u['user']) || isset($u['pass'])) fail(400,'อนุญาตเฉพาะลิงก์ HTTPS');
    };
    foreach($c->library as $r) {$safe($r->url??null);$safe($r->image??null,true);}
    foreach([$c->advisor,...$c->committee,...($c->mentorAdvisors??[])] as $person) {
        if(!is_object($person))fail(400,'ข้อมูลบุคคลไม่ถูกต้อง');
        foreach(['name','title','pos','role'] as $field)if(isset($person->$field)&&!is_string($person->$field))fail(400,'ชื่อและตำแหน่งต้องเป็นข้อความ');
    }
    validate_feature_content($c);
    foreach([$c->advisor,...$c->committee,...($c->mentorAdvisors??[])] as $p) $safe($p->photo??null,true);
}
function validate_assessment(mixed $a): void {
    $fields=['started','date','round','inspector','inspectors','updatedAt','phys','qc','narr','out','ready','survey','ev','rev','adv','sender','quick','wf'];
    if (!is_object($a) || array_diff(array_keys(get_object_vars($a)),$fields)) fail(400,'รูปแบบแบบประเมินไม่ถูกต้อง');
    if (!is_bool($a->started??null)||!date_value($a->date??null)||!is_int($a->round??null)||$a->round<1) fail(400,'วันที่หรือรอบการประเมินไม่ถูกต้อง');
    if (isset($a->ready->date) && !date_value($a->ready->date)) fail(400,'วันที่ลงนามไม่ถูกต้อง');
    foreach(['fromY','toY'] as $k) if (isset($a->ready->$k) && $a->ready->$k!=='' && !preg_match('/^\d{4}$/D',(string)$a->ready->$k)) fail(400,'ปีรับรองไม่ถูกต้อง');
    if (isset($a->wf)) {
        if (!is_object($a->wf)||!in_array($a->wf->status??null,['draft','submitted','returned','reviewed'],true)
            || (isset($a->wf->round)&&(!is_int($a->wf->round)||$a->wf->round<0))
            || (isset($a->wf->log)&&!is_array($a->wf->log))) fail(400,'สถานะหรือประวัติการส่งไม่ถูกต้อง');
        foreach($a->wf->log??[] as $entry) if (!is_string($entry->status??null)||!preg_match('/^[a-z-]{1,32}$/D',$entry->status)) fail(400,'สถานะในประวัติไม่ถูกต้อง');
    }
    if (!is_array($a->phys??null)||count($a->phys)!==15||count(array_filter($a->phys,fn($x)=>!in_array($x,[true,false,null],true)))) fail(400,'ข้อมูลเกณฑ์กายภาพไม่ถูกต้อง');
    $c=criteria();
    if (!is_array($a->qc??null)||count($a->qc)!==count($c->QC)||!is_array($a->narr??null)||count($a->narr)!==count($c->NARR)) fail(400,'จำนวนข้อประเมินไม่ถูกต้อง');
    $score=fn($n,$m)=>$n===null||$n===''||((is_int($n)||is_float($n))&&is_finite((float)$n)&&$n>=0&&$n<=$m);
    foreach($a->qc as $i=>$q) if (!is_object($q)||!is_array($q->subs??null)||count($q->subs)!==count($c->QC[$i]->subs)||count(array_filter($q->subs,fn($v)=>!is_bool($v)))||!property_exists($q,'score')||!$score($q->score,10)) fail(400,'คะแนน Checklist ไม่ถูกต้อง');
    foreach($a->narr as $n) if (!is_object($n)||!property_exists($n,'score')||!$score($n->score,10)||!is_string($n->text??null)||length($n->text)>20000) fail(400,'คะแนนหรือคำบรรยายไม่ถูกต้อง');
    if (!is_object($a->out??null)||!is_array($a->out->c21??null)||count($a->out->c21)!==count($c->OUT->c21->items)
        || !is_array($a->out->t3??null)||count($a->out->t3)!==count($c->OUT->t3->items)||count(array_filter([...$a->out->c21,...$a->out->t3],fn($v)=>!is_bool($v)))) fail(400,'ข้อมูลผลลัพธ์ไม่ถูกต้อง');
    foreach(['o11','o12','o13','o14','c22'] as $k) {
        if (!property_exists($a->out,$k)) fail(400,'ข้อมูลผลลัพธ์ไม่ครบ');
        $v=$a->out->$k;
        if ($v!==null && $v!=='' && (!is_numeric($v)||!in_array((float)$v,array_map(fn($opt)=>(float)$opt[0],$c->OUT->$k->opts),true))) fail(400,'คะแนนผลลัพธ์ไม่ตรงเกณฑ์');
    }
    if (isset($a->inspectors)&&!is_array($a->inspectors)) fail(400,'รายชื่อผู้ตรวจไม่ถูกต้อง');
    if (isset($a->ready) && (!is_object($a->ready) || (isset($a->ready->c) && !is_array($a->ready->c)))) fail(400,'ข้อมูลความพร้อมไม่ถูกต้อง');
    if (isset($a->ev) && !is_object($a->ev)) fail(400,'ข้อมูลหลักฐานไม่ถูกต้อง');
    foreach ($a->ev ?? (object)[] as $ev)
        if (!is_object($ev) || (isset($ev->files) && !is_array($ev->files))) fail(400,'ข้อมูลไฟล์แนบไม่ถูกต้อง');
    if (isset($a->quick) && !is_array($a->quick)) fail(400,'ข้อมูลเอกสารด่วนไม่ถูกต้อง');
    foreach ($a->quick ?? [] as $q)
        if (!is_object($q) || (isset($q->files) && !is_array($q->files))) fail(400,'ข้อมูลเอกสารด่วนไม่ถูกต้อง');
    if (isset($a->survey)) {
        if (!is_object($a->survey)) fail(400,'ข้อมูลสำรวจไม่ถูกต้อง');
        foreach (['sat','conf'] as $k) if (isset($a->survey->$k) && !is_object($a->survey->$k) && !is_array($a->survey->$k)) fail(400,'ข้อมูลสำรวจไม่ถูกต้อง');
        $n=$a->survey->n??''; if (($n!==''&&!is_numeric($n))||numeric($n)<0) fail(400,'จำนวนผู้ตอบไม่ถูกต้อง');
        foreach(['sat','conf'] as $k) foreach($a->survey->$k??(object)[] as $v) if ($v!==null && (!is_numeric($v)||$v<1||$v>5)) fail(400,'คะแนนสำรวจต้องอยู่ระหว่าง 1 ถึง 5');
    }
    if (strlen(encode($a))>1500000) fail(413,'แบบประเมินมีขนาดใหญ่เกินไป');
}
function merge_state(object $current, mixed $input, array $actor): object {
    if (!is_object($input)||!is_array($input->units??null)||!is_array($input->teams??null)||!is_array($input->defects??null)||!is_object($input->assess??null)) fail(400,'รูปแบบข้อมูลไม่ถูกต้อง');
    $visible=project($current,$actor); $next=copy_value($current); $now=now();
    if ($actor['role']!=='coord') foreach($input as $k=>$v) if (!in_array($k,['assess','defects'],true)&&!same($v,$visible->$k??null)) fail(403,'ไม่มีสิทธิ์แก้ไขข้อมูลส่วนกลาง');
    if ($actor['role']==='coord') {
        foreach(['units','teams','fy','cal','mentorCoordinators','publicContent'] as $k) if (property_exists($input,$k)) $next->$k=copy_value($input->$k);
        if (!is_int($next->fy)||$next->fy<1||$next->fy>9999) fail(400,'ปีงบประมาณไม่ถูกต้อง');
        $groups=[];
        foreach($next->teams as $t) {
            if (!is_object($t)||!is_int($t->id??null)||$t->id<1||in_array($t->id,$groups,true)||!is_string($t->name??null)||!trim($t->name)) fail(400,'กลุ่ม MENTOR ไม่ถูกต้อง');
            $groups[]=$t->id;
        }
        foreach($next->cal??(object)[] as $v) if (!date_value($v)) fail(400,'วันที่ในปฏิทินไม่ถูกต้อง');
        if (isset($next->mentorCoordinators)&&!is_array($next->mentorCoordinators)) fail(400,'ข้อมูลผู้ประสานงานไม่ถูกต้อง');
        foreach([...$next->teams,...($next->mentorCoordinators??[])] as $p) validate_content((object)['library'=>[],'advisor'=>(object)['photo'=>$p->photo??''],'committee'=>[],'duties'=>[]]);
        $seq=$current->nextUnitCode??(max([0,...array_map(fn($u)=>(int)($u->code??0),$current->units)])+1);
        $retired=$current->retiredUnitIds??[];
        foreach($current->units as $u) if (!find($next->units,fn($n)=>$n->id===$u->id)&&!in_array($u->id,$retired,true)) $retired[]=$u->id;
        $ids=[];$codes=[];
        foreach($next->units as $u) {
            if (!is_object($u)||!valid_id($u->id??null)||in_array($u->id,$ids,true)||!is_string($u->name??null)||!trim($u->name)||!in_array($u->team??null,$groups,true)) fail(400,'ข้อมูลหน่วยบริการไม่ถูกต้อง');
            $old=find($current->units,fn($x)=>$x->id===$u->id);
            if (in_array($u->id,$retired,true)&&!$old) fail(400,'รหัสรายการหน่วยบริการนี้ถูกยกเลิกแล้ว กรุณาสร้างรายการใหม่');
            if (empty($u->code)) $u->code=str_pad((string)$seq++,6,'0',STR_PAD_LEFT);
            if (!is_string($u->code)||!preg_match('/^\d{6}$/D',$u->code)||in_array($u->code,$codes,true)||(!empty($old->code)&&$old->code!==$u->code)) fail(400,'รหัสหน่วยบริการต้องไม่ซ้ำและเปลี่ยนรหัสเดิมไม่ได้');
            $ids[]=$u->id;$codes[]=$u->code;
        }
        $next->nextUnitCode=$seq;$next->retiredUnitIds=$retired;
        foreach($next->assess as $id=>$v) if (!in_array($id,$ids,true)) unset($next->assess->$id);
        $next->defects=array_values(array_filter($next->defects,fn($d)=>in_array($d->unitId,$ids,true)));
    }
    foreach($input->assess as $id=>$value) {
        if (!allowed($actor,find($next->units,fn($u)=>$u->id===$id))) fail(403,'ไม่มีสิทธิ์เข้าถึงหน่วยบริการนี้');
        $old=$current->assess->$id??null;
        if (same($value,$visible->assess->$id??null)) continue;
        validate_assessment($value); $a=copy_value($value);
        if (($old->wf->status??'draft')==='reviewed') fail(409,'ผลตรวจถูกล็อก ต้องเปิดแก้ไขพร้อมเหตุผลก่อน');
        if (!same($a->wf??null,$old->wf??null)) fail(400,'ต้องเปลี่ยนสถานะผ่านคำสั่ง workflow');
        if ($actor['role']==='mentee') {
            $base=$old??blank_assess();
            foreach(['inspectors','inspector','rev','adv','date','round','phys','out'] as $k)
                if (!same($a->$k??null,$base->$k??null)) fail(403,'หน่วยบริการแก้ไขผลตรวจของ MENTOR ไม่ได้');
            foreach($a->qc as $i=>$q) if (!same($q,$base->qc[$i])) fail(403,'หน่วยบริการให้คะแนน Checklist ไม่ได้');
            foreach($a->narr as $i=>$n) if (!same($n->score,$base->narr[$i]->score)) fail(403,'หน่วยบริการให้คะแนนคำบรรยายไม่ได้');
            if ((bool)($a->ready->verified??false)!==(bool)($old->ready->verified??false)) fail(403,'ยืนยันความพร้อมได้เฉพาะ MENTOR');
        }
        if ($actor['role']!=='mentee'&&($a->wf->status??'')==='submitted') $a->wf->mentorSavedAt=$now;
        $a->updatedAt=$now; $next->assess->$id=$a;
    }
    $incomingIds=[];
    foreach($input->defects as $d) {
        if (!is_object($d)||!valid_id($d->id??null)||in_array($d->id,$incomingIds,true)||!allowed($actor,find($next->units,fn($u)=>$u->id===($d->unitId??null)))) fail(403,'ไม่มีสิทธิ์แก้ไขข้อบกพร่อง');
        $incomingIds[]=$d->id; $old=find($current->defects,fn($x)=>$x->id===$d->id);
        if ($old && !allowed($actor,find($current->units,fn($u)=>$u->id===$old->unitId))) fail(403,'ไม่มีสิทธิ์แก้ไขข้อบกพร่องเดิม');
        if (same($d,$old)) continue;
        if (!in_array($d->status??null,['open','fixing','recheck','closed'],true)||!is_string($d->detail??null)||!trim($d->detail)||length($d->detail)>20000||!date_value($d->due??'')) fail(400,'รายละเอียดหรือสถานะข้อบกพร่องไม่ถูกต้อง');
        if ($actor['role']==='mentee') {
            if (!$old) fail(403,'หน่วยบริการเพิ่มข้อบกพร่องไม่ได้');
            foreach($d as $k=>$v) if (!in_array($k,['response','status','history'],true)&&!same($v,$old->$k??null)) fail(403,'หน่วยบริการแก้ไขได้เฉพาะคำตอบ');
            if ($d->status!=='recheck'||!is_string($d->response??null)||length(trim($d->response))<10) fail(400,'กรุณาระบุผลแก้ไขอย่างน้อย 10 ตัวอักษร');
        }
        $saved=copy_value($d);$saved->history=[...($old->history??[]),(object)['at'=>$now,'status'=>$d->status,'by'=>$actor['name']]];
        $found=false; foreach($next->defects as $i=>$v) if ($v->id===$d->id) {$next->defects[$i]=$saved;$found=true;}
        if (!$found) $next->defects[]=$saved;
    }
    if ($actor['role']!=='mentee') $next->defects=array_values(array_filter($next->defects,fn($d)=>!allowed($actor,find($next->units,fn($u)=>$u->id===$d->unitId))||in_array($d->id,$incomingIds,true)));
    else foreach($visible->defects as $d) if (!in_array($d->id,$incomingIds,true)) fail(403,'หน่วยบริการลบข้อบกพร่องไม่ได้');
    validate_content($next->publicContent??null); unset($next->pins);$next->isSample=false;
    return $next;
}
function transition(object $s, string $id, string $action, array $actor, string $note='', mixed $sender=null): object {
    if (!allowed($actor,find($s->units,fn($u)=>$u->id===$id))) fail(403,'ไม่มีสิทธิ์เข้าถึงหน่วยบริการนี้');
    $a=$s->assess->$id??null; if (!$a) fail(400,'กรุณาบันทึกแบบประเมินก่อน');
    $w=$a->wf??(object)['status'=>'draft','round'=>0,'log'=>[]];$now=now();
    if ($action==='submit') {
        if ($actor['role']!=='mentee') fail(403,'เฉพาะหน่วยบริการส่งตรวจ');
        if ($w->status==='reviewed') fail(409,'ผลตรวจถูกล็อก');
        if (!is_string($sender->name??null)||!trim($sender->name)||length($sender->name)>200||!preg_match('/^\d{9,10}$/D',preg_replace('/\D/','',(string)($sender->tel??'')))) fail(400,'กรุณาระบุชื่อและโทรศัพท์ผู้ส่ง');
        $sender=(object)['name'=>trim($sender->name),'pos'=>mb_substr((string)($sender->pos??''),0,200),'tel'=>mb_substr((string)($sender->tel??''),0,40)];
        if ($w->status!=='submitted') $w->round=($w->round??0)+1;
        $w->status='submitted';$w->submittedAt=$now;$w->sender=$sender;$a->sender=$sender;
    } else {
        if (!in_array($actor['role'],['mentor','coord'],true)) fail(403,'เฉพาะ MENTOR เปลี่ยนผลตรวจ');
        if ($action==='review') {
            if ($w->status==='reviewed') fail(409,'ผลตรวจถูกล็อกแล้ว');
            if (!count($a->inspectors??[])) fail(400,'กรุณาเลือกผู้ตรวจก่อนยืนยันผล');
            $w->status='reviewed';$w->reviewedAt=$now;$w->reviewedBy=$a->inspectors;
        } elseif ($action==='return') {
            if ($w->status==='reviewed') fail(409,'ต้องเปิดแก้ไขก่อนส่งกลับ');
            if (!trim($note)) fail(400,'กรุณาระบุสิ่งที่ต้องแก้ไข');
            $w->status='returned';$w->returnedAt=$now;$w->returnNote=$note;
        } elseif ($action==='reopen') {
            if ($w->status!=='reviewed'||length(trim($note))<10) fail(400,'เปิดแก้ไขได้เฉพาะผลตรวจที่ล็อกและต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
            $w->status='submitted';$w->reopenedAt=$now;$w->mentorSavedAt=null;
        } else fail(400,'คำสั่งไม่ถูกต้อง');
    }
    $w->log=[...($w->log??[]),(object)['at'=>$now,'status'=>$action==='reopen'?'reopened':$w->status,'by'=>$actor['name'],'note'=>$note]];
    $a->wf=$w;$a->updatedAt=$now;return $s;
}
function references(object $s): array {
    $refs=[];
    foreach($s->assess as $id=>$a) foreach(collect_files($a) as $f) {$v=copy_value($f);$v->unitId=$id;$refs[]=$v;}
    return $refs;
}
function collect_files(?object $a): array {
    $files=[];
    foreach($a->ev??(object)[] as $ev) foreach($ev->files??[] as $f) $files[]=$f;
    foreach($a->quick??[] as $q) foreach($q->files??[] as $f) $files[]=$f;
    return $files;
}
function prepare_import(object $current, mixed $source): object {
    if (!is_object($source)||!is_array($source->units??null)||!is_array($source->teams??null)||!is_object($source->assess??null)||!is_array($source->defects??null)) fail(400,'ไฟล์ข้อมูล GECC ไม่ถูกต้อง');
    if (!empty($source->isSample)) fail(400,'พบเครื่องหมายข้อมูลสาธิต กรุณาให้เจ้าของข้อมูลตรวจจำแนกก่อนนำเข้า');
    if (count(get_object_vars($current->assess))||count($current->defects)) fail(409,'ระบบกลางมีข้อมูลประเมินแล้ว ไม่สามารถแทนที่อัตโนมัติ');
    $ids=array_map(fn($u)=>$u->id,$current->units);$sids=array_map(fn($u)=>$u->id??null,$source->units);
    if (count($sids)!==count($ids)||count(array_unique($sids))!==count($ids)||array_diff($sids,$ids)) fail(400,'รายชื่อหน่วยบริการต่างจากระบบกลาง ต้องตรวจจับคู่รหัสก่อน');
    $next=copy_value($current);
    foreach(['teams','mentorCoordinators','cal','fy'] as $k) if (property_exists($source,$k)) $next->$k=copy_value($source->$k);
    $next->units=copy_value($source->units);
    foreach($next->units as $u) $u->code=find($current->units,fn($x)=>$x->id===$u->id)->code;
    $actor=['role'=>'coord','name'=>'Migration'];
    $next=merge_state($current,project($next,$actor),$actor);
    $next->assess=copy_value($source->assess);$next->defects=copy_value($source->defects);
    foreach($next->assess as $id=>$a) {if (!in_array($id,$ids,true)) fail(400,'พบผลประเมินที่ไม่มีหน่วยบริการ');validate_assessment($a);}
    $seen=[];
    foreach($next->defects as $d) {
        if (!in_array($d->unitId??null,$ids,true)||!valid_id($d->id??null)||in_array($d->id,$seen,true)||!in_array($d->status??null,['open','fixing','recheck','closed'],true)) fail(400,'ข้อมูลข้อบกพร่องไม่ถูกต้อง');
        $seen[]=$d->id;
    }
    unset($next->pins);$next->isSample=false;return $next;
}
