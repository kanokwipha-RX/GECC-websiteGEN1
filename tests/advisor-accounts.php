<?php
declare(strict_types=1);
require __DIR__.'/../php/bootstrap.php';
if(is_file(__DIR__.'/../php/advisor-account-plan.php'))require __DIR__.'/../php/advisor-account-plan.php';
function check_advisor(bool $condition,string $message):void {if(!$condition)throw new RuntimeException($message);}
check_advisor(function_exists('GECC\\advisor_account_bundle'),'Advisor preparation must be implemented');
$source=GECC\decode(file_get_contents(__DIR__.'/../shared/roster-2570.json'));
$grants=(object)['format'=>'gecc-advisor-grants-v1','accounts'=>[]];
foreach($source->publicContent->mentorAdvisors as $i=>$person)$grants->accounts[]=(object)[
    'username'=>'advisor-'.str_pad((string)($i+1),2,'0',STR_PAD_LEFT),'name'=>$person->name,
    'role'=>in_array($i,[1,5],true)?'coord':'mentor','team'=>null,'grantConfirmed'=>in_array($i,[1,5],true)];
$bundle=GECC\advisor_account_bundle($grants,$source);
check_advisor(count($bundle->accounts)===6,'All six requested advisor identities must be present');
check_advisor(count(array_filter($bundle->accounts,fn($a)=>isset($a->password)))===6,'All six requested passwords are prepared independently of pending authority');
check_advisor(count(array_filter($bundle->accounts,fn($a)=>!$a->grantConfirmed&&isset($a->password)))===4,'Pending authority must remain explicit even with a prepared password');
check_advisor($bundle->accounts[1]->role==='coord'&&$bundle->accounts[5]->role==='coord','Confirmed administrator grants must retain full rights');
try{GECC\advisor_bundle_ready($bundle,$source);throw new RuntimeException('Pending grants were allowed');}
catch(GECC\HttpError $e){check_advisor($e->status===409,'Pending grants must block provisioning');}
foreach($grants->accounts as $i=>$account)if(!$account->grantConfirmed){$account->team=0;$account->grantConfirmed=true;}
$complete=GECC\advisor_account_bundle($grants,$source,$bundle);
check_advisor($complete->accounts[1]->password===$bundle->accounts[1]->password,'Completing grants must not rotate an already prepared password');
check_advisor(count(array_unique(array_map(fn($a)=>$a->password,$complete->accounts)))===6,'Passwords must be distinct');
GECC\advisor_bundle_ready($complete,$source);
foreach($source->units as $unit){
 check_advisor(GECC\allowed(['role'=>'mentor','team'=>0],$unit),'Explicit all-group reviewer can inspect each group');
 check_advisor(!GECC\allowed(['role'=>'mentor','team'=>null],$unit),'Missing scope must not grant all groups');
 check_advisor(GECC\allowed(['role'=>'mentor','team'=>1],$unit)===($unit->team===1),'Normal mentor remains group scoped');
}

$bad=GECC\copy_value($grants);$bad->accounts[0]->name='Unconfirmed different person';
try{GECC\advisor_account_bundle($bad,$source);throw new RuntimeException('Changed identity accepted');}
catch(GECC\HttpError $e){check_advisor($e->status===400,'Identity must exactly match the source');}
echo "PASS advisor bundles require confirmed scopes, preserve prepared passwords and reject identity changes\n";
