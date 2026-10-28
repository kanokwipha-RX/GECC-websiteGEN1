<?php
declare(strict_types=1);
namespace GECC;
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
require __DIR__.'/bootstrap.php';
require __DIR__.'/install.php';
try {
    $cmd=$argv[1]??'';
    if ($cmd==='check') {
        $c=config();$version=query('SELECT VERSION()')->fetchColumn();
        echo encode(['ok'=>true,'php'=>PHP_VERSION,'databaseVersion'=>$version,'pdoDriver'=>db()->getAttribute(\PDO::ATTR_DRIVER_NAME),
            'connectionCharset'=>query('SELECT @@character_set_connection')->fetchColumn(),'argon2id'=>true,'privateFilesWritable'=>is_writable($c['files'])]);
    } elseif ($cmd==='install'&&($argv[2]??'')==='--apply') {
        echo encode(install());
    } elseif (in_array($cmd,['accounts-check','accounts-apply'],true)) {
        $bundle=decode(file_get_contents(__DIR__.'/accounts.json'));
        echo encode(provision_accounts($bundle,$cmd==='accounts-apply'));
    } else {
        fwrite(STDERR,"Usage: php manage.php check | install --apply | accounts-check | accounts-apply\n");exit(2);
    }
    echo "\n";
} catch(\Throwable $e) {
    fwrite(STDERR,$e instanceof HttpError?$e->getMessage():'GECC command failed; check database configuration/permissions privately.');
    exit(1);
}
