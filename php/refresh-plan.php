<?php
declare(strict_types=1);
namespace GECC;

function refresh_value(mixed $live, mixed $base, mixed $wanted, string $path, array &$changes, array &$conflicts): mixed {
    if (same($wanted,$base)||same($live,$wanted)) return copy_value($live);
    if (same($live,$base)) { $changes[]=$path; return copy_value($wanted); }
    if (is_object($live)&&is_object($wanted)) {
        $next=copy_value($live);
        foreach($wanted as $key=>$value) $next->$key=refresh_value($live->$key??null,$base->$key??null,$value,$path.'.'.$key,$changes,$conflicts);
        return $next;
    }
    if (is_array($live)&&is_array($base)&&is_array($wanted)) {
        $named=fn($items)=>count(array_filter($items,fn($p)=>is_object($p)&&is_string($p->name??null)&&$p->name!==''))===count($items)
            &&count(array_unique(array_map(fn($p)=>$p->name,$items)))===count($items);
        if($named($live)&&$named($base)&&$named($wanted)) {
            $next=[];
            foreach($wanted as $person) {
                $old=find($live,fn($p)=>$p->name===$person->name);$original=find($base,fn($p)=>$p->name===$person->name);
                if(!$old&&$original){$conflicts[]=$path.'.'.$person->name;continue;}
                $next[]=$old?refresh_value($old,$original??(object)[],$person,$path.'.'.$person->name,$changes,$conflicts):copy_value($person);
                if(!$old)$changes[]=$path.'.'.$person->name;
            }
            foreach($live as $person) if(!find($wanted,fn($p)=>$p->name===$person->name)) {
                $original=find($base,fn($p)=>$p->name===$person->name);
                if(!$original||!same($person,$original))$conflicts[]=$path.'.'.$person->name;
                else $changes[]=$path.'.remove.'.$person->name;
            }
            return $next;
        }
        if(count($live)===count($base)&&count($wanted)===count($base)) {
            $next=[];
            foreach($wanted as $i=>$value)$next[]=refresh_value($live[$i],$base[$i],$value,$path.'.'.$i,$changes,$conflicts);
            return $next;
        }
    }
    $conflicts[]=$path;
    return copy_value($live);
}

function content_refresh_plan(object $live, object $wanted, object $base, array $accounts=[]): array {
    if(count($wanted->units??[])!==32||count($wanted->teams??[])!==6
        ||array_sum(array_map(fn($t)=>count($t->members??[]),$wanted->teams))!==24
        ||count($wanted->publicContent->mentorAdvisors??[])!==6)fail(400,'ข้อมูลต้นทางต้องมี 32 หน่วยงาน 24 MENTOR และที่ปรึกษา 6 คน');
    $next=copy_value($live);$changes=[];$conflicts=[];$ids=[];$codes=[];
    $teamIds=array_map(fn($t)=>$t->id??null,$wanted->teams);sort($teamIds);
    if($teamIds!==[1,2,3,4,5,6])fail(400,'กลุ่มต้นทางต้องครบ 1–6 และไม่ซ้ำ');
    foreach($wanted->teams as $team) {
        if(count($team->members??[])!==4)fail(400,'MENTOR ต้องมี 4 คนต่อกลุ่ม');
        foreach($team->members as $member) {
            if(!is_string($member->name??null)||!trim($member->name))fail(400,'ชื่อ MENTOR ไม่ครบ');
            validate_content((object)['library'=>[],'advisor'=>$member,'committee'=>[],'duties'=>[]]);
        }
    }
    foreach($wanted->units as $unit) {
        if(!valid_id($unit->id??null)||!is_string($unit->code??null)||!preg_match('/^\d{6}$/D',$unit->code)
            ||in_array($unit->id,$ids,true)||in_array($unit->code,$codes,true)||!is_string($unit->name??null)||!trim($unit->name)
            ||!find($wanted->teams,fn($t)=>$t->id===($unit->team??null)))fail(400,'รหัส ชื่อ หรือกลุ่มหน่วยงานต้นทางไม่ถูกต้อง/ซ้ำ');
        $ids[]=$unit->id;$codes[]=$unit->code;
    }
    $next->units=[];
    foreach($wanted->units as $unit) {
        $old=find($live->units,fn($u)=>$u->id===$unit->id);$original=find($base->units,fn($u)=>$u->id===$unit->id);
        if(!$old&&in_array($unit->id,$live->retiredUnitIds??[],true)){$conflicts[]='units.'.$unit->id.'.retired-id';continue;}
        if($old&&$old->code!==$unit->code){$conflicts[]='units.'.$unit->id.'.code';$next->units[]=copy_value($old);continue;}
        if(!$old&&find($live->units,fn($u)=>$u->code===$unit->code)){$conflicts[]='units.'.$unit->id.'.code-in-use';continue;}
        $next->units[]=$old?refresh_value($old,$original??(object)[],$unit,'units.'.$unit->id,$changes,$conflicts):copy_value($unit);
        if(!$old)$changes[]='units.add.'.$unit->id;
    }
    foreach($live->units as $unit)if(!in_array($unit->id,$ids,true)){$conflicts[]='units.'.$unit->id.'.missing-from-source';$next->units[]=copy_value($unit);}
    $next->nextUnitCode=max($live->nextUnitCode??1,max(array_map('intval',$codes))+1);
    foreach($wanted->teams as $team) {
        $index=array_search($team->id,array_map(fn($t)=>$t->id,$next->teams),true);
        $original=find($base->teams,fn($t)=>$t->id===$team->id);
        if($index===false||!$original){$conflicts[]='teams.'.$team->id;continue;}
        $next->teams[$index]=refresh_value($next->teams[$index],$original,$team,'teams.'.$team->id,$changes,$conflicts);
    }
    foreach(['advisor','committee','mentorAdvisors','duties'] as $key)if(isset($wanted->publicContent->$key))
        $next->publicContent->$key=refresh_value($live->publicContent->$key??null,$base->publicContent->$key??null,$wanted->publicContent->$key,'publicContent.'.$key,$changes,$conflicts);
    $next->publicContent->albums=$live->publicContent->albums??[];
    foreach($wanted->publicContent->albums??[] as $album) {
        $match=fn($a)=>(isset($a->id,$album->id)&&$a->id===$album->id)||(($a->date??'')===($album->date??'')&&$a->title===$album->title);
        $existing=find($next->publicContent->albums,$match);
        if(!$existing){$next->publicContent->albums[]=copy_value($album);$changes[]='albums.add.'.$album->title;}
        elseif(!same($existing,$album))$conflicts[]='albums.'.$album->title;
    }
    validate_content($next->publicContent);
    $identities=[];
    foreach($accounts as $account)if(in_array($account['role'],['mentor','coord'],true)) {
        $matches=[];foreach($wanted->teams as $team)foreach($team->members as $member)if($member->name===$account['name'])$matches[]=$team->id;
        $status=count($matches)===1?($account['role']==='coord'?'existing-coordinator-permissions-preserved':((int)$account['team']===$matches[0]?'matched':'group-scope-review')):'name-identity-review';
        $identities[]=['username'=>$account['username'],'name'=>$account['name'],'role'=>$account['role'],'team'=>$account['team'],'rosterTeams'=>$matches,'status'=>$status];
    }
    $unlinked=[];
    foreach($wanted->teams as $team)foreach($team->members as $member)
        if(!find($accounts,fn($a)=>in_array($a['role'],['mentor','coord'],true)&&$a['name']===$member->name))$unlinked[]=['kind'=>'mentor','name'=>$member->name,'team'=>$team->id];
    foreach($wanted->publicContent->mentorAdvisors as $person)
        if(!find($accounts,fn($a)=>in_array($a['role'],['mentor','coord'],true)&&$a['name']===$person->name
            &&(!isset($person->loginUsername)||$a['username']===$person->loginUsername)))$unlinked[]=['kind'=>'advisor','name'=>$person->name];
    return ['next'=>$next,'changes'=>array_values(array_unique($changes)),'conflicts'=>array_values(array_unique($conflicts)),
        'accountReview'=>$identities,'unlinkedPeople'=>$unlinked,'accountsChanged'=>false,'canApply'=>!$conflicts];
}
