<?php
declare(strict_types=1);
namespace GECC;
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';
require __DIR__.'/advisor-account-plan.php';
try {
    $command=$argv[1]??'';$path=$argv[2]??'';
    if(!in_array($command,['prepare','check','apply'],true)||!is_file($path))fail(400,'Usage: php advisor-accounts.php prepare grants.json private-output.json | check bundle.json | apply bundle.json REVISION');
    $source=decode(file_get_contents(__DIR__.'/data/seed.json'));
    if($command==='prepare') {
        $output=$argv[3]??'';
        if(!str_ends_with($output,'.json')||!is_dir(dirname($output)))fail(400,'ใช้พาธ JSON ส่วนตัวในโฟลเดอร์ที่มีอยู่แล้วนอกพื้นที่เว็บ');
        $existing=is_file($output)?decode(file_get_contents($output)):null;
        $bundle=advisor_account_bundle(decode(file_get_contents($path)),$source,$existing);
        $temporary=$output.'.'.uid().'.tmp';$encoded=encode($bundle);
        if(file_put_contents($temporary,$encoded,LOCK_EX)!==strlen($encoded))throw new \RuntimeException();chmod($temporary,0600);
        if(!rename($temporary,$output))throw new \RuntimeException();
        echo encode(['prepared'=>count($bundle->accounts),'confirmed'=>count(array_filter($bundle->accounts,fn($a)=>$a->grantConfirmed)),
            'pending'=>count(array_filter($bundle->accounts,fn($a)=>!$a->grantConfirmed)),'databaseChanged'=>false])."\n";exit;
    }
    $bundle=decode(file_get_contents($path));advisor_bundle_ready($bundle,$source);
    $report=tx(function()use($bundle,$command,$argv){
        [$state,$revision]=state(true);$pending=[];$skipped=0;
        foreach($bundle->accounts as $account) {
            if($account->role==='mentor'&&$account->team!==0&&!find($state->teams,fn($t)=>$t->id===$account->team))fail(400,'กลุ่มไม่มีอยู่ในระบบ');
            $old=query('SELECT id,username,name,role,unit_id,team FROM gecc_accounts WHERE username=?',[$account->username])->fetch();
            if($old) {
                if($old['name']!==$account->name||$old['role']!==$account->role||$old['unit_id']!==null
                    ||($old['team']===null?null:(int)$old['team'])!==$account->team)fail(409,'บัญชีเดิมมีเจ้าของหรือสิทธิ์ต่างกัน ไม่เขียนทับ');
                $skipped++;
            }else $pending[]=$account;
        }
        if($command==='apply') {
            if(!isset($argv[3])||!ctype_digit($argv[3])||(int)$argv[3]!==$revision)fail(409,'ใช้ revision จาก check ล่าสุด');
            foreach($pending as $account) {
                $id=uid();query('INSERT INTO gecc_accounts(id,username,name,password_hash,role,unit_id,team) VALUES(?,?,?,?,?,NULL,?)',
                    [$id,$account->username,$account->name,password_hash_value($account->password),$account->role,$account->team]);
                audit($id,'provision-advisor',$id,$revision);
            }
        }
        return ['applied'=>$command==='apply','revision'=>$revision,'total'=>6,'skipped'=>$skipped,
            $command==='apply'?'created':'wouldCreate'=>count($pending),'existingAccountsChanged'=>false];
    });echo encode($report)."\n";
}catch(\Throwable $e){fwrite(STDERR,($e instanceof HttpError?$e->getMessage():'Advisor account operation failed; inspect private logs.')."\n");exit(1);}
