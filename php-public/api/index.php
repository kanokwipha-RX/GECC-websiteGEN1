<?php
declare(strict_types=1);
ini_set('display_errors', '0');
// Default layout: /home/USER/public_html/sskgecc/api and /home/USER/gecc-private.
// This file contains no credentials. Adjust private-path.php if the host differs.
try {
    $private = require __DIR__ . '/private-path.php';
    if (!is_string($private) || !is_file($private . '/bootstrap.php')) throw new RuntimeException();
    require $private . '/bootstrap.php';
    require $private . '/api.php';
    \GECC\api();
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":"ยังไม่พร้อมเชื่อมต่อระบบ กรุณาให้ผู้ดูแลตรวจเส้นทางโฟลเดอร์ส่วนตัว"}';
}
