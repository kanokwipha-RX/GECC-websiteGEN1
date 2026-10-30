<?php
declare(strict_types=1);
// Copy to config.local.php OUTSIDE public_html. Never commit filled credentials.
return [
    'dsn' => 'mysql:host=localhost;dbname=CHANGE_ME;charset=utf8mb4',
    'db_user' => 'CHANGE_ME',
    'db_password' => 'CHANGE_ME',
    'origin' => 'https://www.osscsskfda.org',
    'base_path' => '/sskgecc',
    'secure_cookie' => true,
    'allow_web_setup' => false,
    'schema_preinstalled' => false,
    'setup_token_hash' => 'BUILD_INSERTS_TOKEN_HASH',
    // Generate privately with password_hash($password, PASSWORD_ARGON2ID). Never put the password in JavaScript.
    'library_password_hash' => '',
    'files' => __DIR__ . '/files',
];
