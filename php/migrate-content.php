<?php
declare(strict_types=1);
namespace GECC;
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';
try {
    if(($argv[1]??'')!=='--apply'){echo "Usage: php migrate-content.php --apply\nBack up database and private files first.\n";exit(2);}
    if((int)query("SELECT GET_LOCK('gecc_content_v2',30)")->fetchColumn()!==1)throw new \RuntimeException();
    try {
        if(query('SELECT version FROM gecc_schema_version WHERE version=2')->fetchColumn()){echo "Content v2 already applied\n";exit;}
        [$before]=state();$dir=__DIR__.'/backups';if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new \RuntimeException();
        $backup=$dir.'/content-v2-'.gmdate('Ymd-His').'-'.uid().'.json';
        if(file_put_contents($backup,encode($before),LOCK_EX)===false)throw new \RuntimeException();chmod($backup,0600);
        tx(function(){[$s,$r]=state(true);$defaults=decode(file_get_contents(__DIR__.'/data/content-defaults.json'));foreach($defaults as $k=>$v)if(!isset($s->publicContent->$k))$s->publicContent->$k=$v;
            query('UPDATE gecc_app_state SET document=?,revision=? WHERE id=1',[encode($s),$r+1]);query('INSERT INTO gecc_schema_version(version) VALUES(2)');audit(null,'content-migrate','v2',$r+1);});
        echo "Content v2 applied; private backup created. Accounts, assessments and files preserved.\n";
    }finally{query("SELECT RELEASE_LOCK('gecc_content_v2')");}
}catch(\Throwable $e){fwrite(STDERR,"Migration failed; preserve backup and inspect server logs privately.\n");exit(1);}
