<?php
declare(strict_types=1);
$candidates = [
    '/home/osscsskf/gecc-private',
    dirname(__DIR__, 4) . '/gecc-private',
    dirname(__DIR__, 3) . '/gecc-private',
];
foreach ($candidates as $c) {
    if (is_file($c . '/bootstrap.php')) return $c;
}
return dirname(__DIR__, 3) . '/gecc-private';
