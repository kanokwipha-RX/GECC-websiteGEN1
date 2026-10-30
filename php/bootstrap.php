<?php
declare(strict_types=1);
namespace GECC;

final class HttpError extends \RuntimeException {
    public function __construct(public int $status, string $message) { parent::__construct($message); }
}
function fail(int $status, string $message): never { throw new HttpError($status, $message); }
function encode(mixed $v): string { return json_encode($v, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function decode(string $v): mixed { return json_decode($v, false, 512, JSON_THROW_ON_ERROR); }
function copy_value(mixed $v): mixed { return decode(encode($v)); }
function now(): string { return gmdate('Y-m-d\TH:i:s') . '.000Z'; }
function today(): string { return (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Bangkok')))->format('Y-m-d'); }
function uid(): string { return bin2hex(random_bytes(16)); }
function length(string $v): int { return mb_strlen($v, 'UTF-8'); }
function config(): array {
    static $config;
    if ($config !== null) return $config;
    if (PHP_VERSION_ID < 80300 || !extension_loaded('pdo_mysql') || !extension_loaded('mbstring')
        || !in_array('argon2id', password_algos(), true)) {
        fail(503, 'ต้องใช้ PHP 8.3 พร้อม PDO MySQL, mbstring และ Argon2id');
    }
    $path = __DIR__ . '/config.local.php';
    if (!is_file($path)) fail(503, 'ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณาติดต่อผู้ดูแล');
    $c = require $path;
    if (!is_array($c)) fail(503, 'ค่าตั้งระบบไม่ถูกต้อง');
    $origin = $c['origin'] ?? '';
    $u = parse_url($origin);
    $local = in_array($u['host'] ?? '', ['127.0.0.1', 'localhost'], true);
    if (!$u || isset($u['user']) || isset($u['pass']) || isset($u['path']) || isset($u['query']) || isset($u['fragment'])
        || (($u['scheme'] ?? '') !== 'https' && !(($u['scheme'] ?? '') === 'http' && $local))
        || (($u['scheme'] ?? '') === 'https' && empty($c['secure_cookie']))) fail(503, 'Origin/HTTPS ตั้งค่าไม่ถูกต้อง');
    $base = rtrim($c['base_path'] ?? '', '/');
    if ($base !== '' && !preg_match('~^/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$~D', $base)) fail(503, 'เส้นทางระบบไม่ถูกต้อง');
    $c['base_path'] = $base;
    if (!str_starts_with($c['dsn'] ?? '', 'mysql:') || !str_contains($c['dsn'], 'charset=utf8mb4')) fail(503, 'ฐานข้อมูลต้องใช้ PDO MySQL และ utf8mb4');
    $private = realpath(__DIR__);
    $doc = isset($_SERVER['DOCUMENT_ROOT']) && $_SERVER['DOCUMENT_ROOT'] !== '' ? realpath($_SERVER['DOCUMENT_ROOT']) : false;
    if ($doc && ($private === $doc || str_starts_with(str_replace('\\', '/', $private), rtrim(str_replace('\\', '/', $doc), '/') . '/')))
        fail(503, 'ต้องวางโฟลเดอร์ส่วนตัวนอก document root');
    $fileRoot = $c['files'] ?? (__DIR__ . '/files');
    if (!is_dir($fileRoot) && !mkdir($fileRoot, 0700, true)) fail(503, 'เตรียมที่เก็บไฟล์ไม่สำเร็จ');
    $realFiles = realpath($fileRoot);
    if (!$realFiles || !is_writable($realFiles) || ($doc && ($realFiles === $doc || str_starts_with(str_replace('\\', '/', $realFiles), rtrim(str_replace('\\', '/', $doc), '/') . '/'))))
        fail(503, 'ที่เก็บไฟล์ต้องเขียนได้และอยู่นอกพื้นที่เว็บ');
    $c['files'] = $realFiles;
    return $config = $c;
}
function db(): \PDO {
    static $db;
    if ($db) return $db;
    $c = config();
    $db = new \PDO($c['dsn'], $c['db_user'], $c['db_password'], [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_EMULATE_PREPARES => false, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
    ]);
    $db->exec("SET time_zone = '+00:00'");
    return $db;
}
function query(string $sql, array $args = []): \PDOStatement {
    $s = db()->prepare($sql); $s->execute($args); return $s;
}
function tx(callable $fn): mixed {
    db()->beginTransaction();
    try { $v = $fn(); db()->commit(); return $v; }
    catch (\Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
}
function state(bool $lock = false): array {
    $row = query('SELECT document,revision FROM gecc_app_state WHERE id=1' . ($lock ? ' FOR UPDATE' : ''))->fetch();
    if (!$row) fail(503, 'ยังไม่ได้เตรียมข้อมูลระบบ');
    return [decode($row['document']), (int)$row['revision']];
}
function audit(?string $actor, string $action, string $resource, ?int $revision = null): void {
    query('INSERT INTO gecc_audit(id,account_id,action,resource,revision) VALUES(?,?,?,?,?)', [uid(), $actor, $action, $resource, $revision]);
}
function save_state(object $s, int $r, string $actor, string $action, string $resource = 'state'): array {
    query('UPDATE gecc_app_state SET document=?,revision=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=1', [encode($s), $r + 1]);
    audit($actor, $action, $resource, $r + 1);
    return result($s, $r + 1, $GLOBALS['actor'] ?? null);
}
function result(object $s, int $r, ?array $a): array { return ['state' => project($s, $a), 'revision' => $r, 'summary' => summary($s)]; }
function password_valid(mixed $p): bool { return is_string($p) && length($p) >= 12 && length($p) <= 128; }
function password_hash_value(mixed $p): string {
    if (!password_valid($p)) fail(400, 'รหัสผ่านต้องมี 12–128 ตัวอักษร');
    return password_hash($p, PASSWORD_ARGON2ID);
}
function account_view(array $a): array {
    return ['id' => $a['id'], 'username' => $a['username'], 'name' => $a['name'], 'role' => $a['role'],
        'unitId' => $a['unit_id'], 'team' => $a['team'] === null ? null : (int)$a['team'], 'mustChange' => (bool)$a['must_change']];
}
require_once __DIR__ . '/domain.php';
require_once __DIR__ . '/policy.php';

require_once __DIR__ . '/public-features.php';
