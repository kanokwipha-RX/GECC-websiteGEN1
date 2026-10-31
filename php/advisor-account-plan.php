<?php
declare(strict_types=1);
namespace GECC;

function advisor_grants(object $input,object $source):array {
    $people=$source->publicContent->mentorAdvisors??[];
    if(!in_array($input->format??'',['gecc-advisor-grants-v1','gecc-advisor-accounts-v1'],true)
        ||count($input->accounts??[])!==6||count($people)!==6)fail(400,'ต้องมีที่ปรึกษาที่ตรงต้นทางครบ 6 คน');
    $expected=[];
    foreach($people as $i=>$person)$expected[$person->loginUsername??('advisor-'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT))]=$person->name;
    $seen=[];$result=[];
    foreach($input->accounts as $account) {
        $username=$account->username??'';
        if(!is_string($username)||!isset($expected[$username])||isset($seen[$username])||($account->name??null)!==$expected[$username]
            ||!in_array($account->role??null,['mentor','coord'],true)||!is_bool($account->grantConfirmed??null))fail(400,'ชื่อ บัญชี หรือสิทธิ์ไม่ตรงรายชื่อที่ยืนยัน');
        $seen[$username]=true;$team=$account->team??null;
        if(($account->role==='coord'&&$team!==null)||($account->role==='mentor'&&$account->grantConfirmed&&(!is_int($team)||$team<0||$team>6))
            ||(!$account->grantConfirmed&&$team!==null))fail(400,'ต้องยืนยันกลุ่มจริงก่อนให้สิทธิ์ MENTOR');
        $result[]=(object)['username'=>$username,'name'=>$account->name,'role'=>$account->role,'unitId'=>null,
            'team'=>$team,'grantConfirmed'=>$account->grantConfirmed];
    }
    return $result;
}

function advisor_account_bundle(object $grants,object $source,?object $existing=null):object {
    $accounts=advisor_grants($grants,$source);
    if($existing) {
        if(($existing->format??'')!=='gecc-advisor-accounts-v1')fail(400,'ไฟล์บัญชีเดิมไม่ถูกต้อง');
        advisor_grants($existing,$source);
    }
    foreach($accounts as $account) {
        $old=$existing?find($existing->accounts??[],fn($a)=>($a->username??null)===$account->username):null;
        if($old&&($old->name!==$account->name||($old->grantConfirmed&&(!$account->grantConfirmed||$old->role!==$account->role||$old->team!==$account->team))))
            fail(409,'ห้ามเปลี่ยนเจ้าของหรือสิทธิ์บัญชีที่เตรียมและยืนยันแล้วโดยอัตโนมัติ');
        $account->password=$old->password??rtrim(strtr(base64_encode(random_bytes(18)),'+/','-_'),'=');
        if(!password_valid($account->password))fail(400,'รหัสผ่านในไฟล์ส่วนตัวไม่ถูกต้อง');
    }
    return (object)['format'=>'gecc-advisor-accounts-v1','createdAt'=>$existing->createdAt??now(),
        'credentialStatus'=>'prepared-not-installed','accounts'=>$accounts];
}

function advisor_bundle_ready(object $bundle,object $source):void {
    if(($bundle->format??'')!=='gecc-advisor-accounts-v1')fail(400,'ใช้ไฟล์บัญชีที่เตรียมแล้ว');
    advisor_grants($bundle,$source);
    foreach($bundle->accounts as $account)if(!$account->grantConfirmed)fail(409,'ยังไม่ยืนยันกลุ่มครบ ห้าม provision บัญชีที่ปรึกษาชุดนี้');
    foreach($bundle->accounts as $account)if(!password_valid($account->password??null))fail(400,'รหัสผ่านส่วนตัวไม่ครบ');
}
