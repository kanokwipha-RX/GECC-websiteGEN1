<?php
declare(strict_types=1);
namespace GECC;
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';
require __DIR__.'/refresh-plan.php';
try {
    $apply=($argv[1]??'')==='--apply';
    if(($argv[1]??'')!==''&&!$apply)fail(400,'Usage: php content-refresh.php [--apply REVISION]');
    if((int)query("SELECT GET_LOCK('gecc_content_refresh',30)")->fetchColumn()!==1)fail(409,'มีการปรับเนื้อหาอื่นอยู่');
    try {
        $report=tx(function()use($apply,$argv){
            [$current,$revision]=state(true);
            $wanted=decode(file_get_contents(__DIR__.'/data/seed.json'));
            $baseline=decode(file_get_contents(__DIR__.'/data/content-refresh-baseline.json'));
            $accounts=query('SELECT username,name,role,team FROM gecc_accounts ORDER BY username')->fetchAll();
            $plan=content_refresh_plan($current,$wanted,$baseline,$accounts);$next=$plan['next'];unset($plan['next']);
            if(!$apply)return $plan+['applied'=>false,'revision'=>$revision];
            if(!isset($argv[2])||!ctype_digit($argv[2])||(int)$argv[2]!==$revision)fail(409,'ใช้ revision จาก preview ล่าสุด');
            if(!$plan['canApply'])fail(409,'พบข้อมูลที่แก้เองหรือจับคู่ไม่ได้ กรุณาตรวจ conflicts จาก preview ก่อน ไม่ได้เขียนข้อมูล');
            if(same($current,$next))return $plan+['applied'=>false,'revision'=>$revision,'alreadyCurrent'=>true];
            $dir=__DIR__.'/backups';if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new \RuntimeException();
            $path=$dir.'/content-refresh-'.gmdate('Ymd-His').'-'.uid().'.json';
            if(file_put_contents($path,encode($current),LOCK_EX)===false)throw new \RuntimeException();chmod($path,0600);
            query('UPDATE gecc_app_state SET document=?,revision=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=1',[encode($next),$revision+1]);
            audit(null,'content-refresh','roster-2570',$revision+1);
            return $plan+['applied'=>true,'revision'=>$revision+1,'backupCreated'=>true];
        });echo encode($report)."\n";
    }finally{query("SELECT RELEASE_LOCK('gecc_content_refresh')");}
}catch(\Throwable $e){fwrite(STDERR,($e instanceof HttpError?$e->getMessage():'Content refresh failed; inspect private logs.')."\n");exit(1);}
