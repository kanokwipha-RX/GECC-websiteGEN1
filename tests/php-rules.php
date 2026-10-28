<?php
declare(strict_types=1);
require dirname(__DIR__).'/php/bootstrap.php';
$values=\GECC\decode(stream_get_contents(STDIN));
echo \GECC\encode(array_map(fn($a)=>[\GECC\calc($a),\GECC\sub_of($a),\GECC\ready_of($a)],$values));
