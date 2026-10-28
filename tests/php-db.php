<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli'||getenv('GECC_ISOLATED_TEST')!=='1') exit(1);
$root=getenv('GECC_TEST_PRIVATE');
require $root.'/bootstrap.php';
$input=\GECC\decode(stream_get_contents(STDIN));
$stmt=\GECC\query($input->sql,$input->args??[]);
echo \GECC\encode($stmt->columnCount()?$stmt->fetchAll():[]);
