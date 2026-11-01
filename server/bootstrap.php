<?php

declare(strict_types=1);

use Life\Config;

define('LIFE_ROOT', dirname(__DIR__));

$autoload = LIFE_ROOT . '/vendor/autoload.php';
if (!is_file($autoload)) {
    throw new RuntimeException('Dependencies are missing. Run composer install --no-dev first.');
}

require $autoload;
Config::load(LIFE_ROOT);

date_default_timezone_set(Config::get('APP_TIMEZONE', 'Europe/Berlin') ?? 'Europe/Berlin');

if (PHP_SAPI !== 'cli' && session_status() !== PHP_SESSION_ACTIVE) {
    $sessionLifetime = 60 * 60 * 24 * 30;
    // PHP's default garbage collection removes sessions after 24 idle minutes,
    // and sessions in the shared /tmp directory are cleaned up by other sites'
    // requests too. Keep them in our own directory for as long as the cookie lives.
    $sessionPath = LIFE_ROOT . '/server/storage/sessions';
    if (is_dir($sessionPath) || @mkdir($sessionPath, 0700, true)) {
        if (is_writable($sessionPath)) {
            session_save_path($sessionPath);
        }
    }
    ini_set('session.gc_maxlifetime', (string) $sessionLifetime);
    ini_set('session.use_strict_mode', '1');
    session_name(Config::get('SESSION_NAME', 'life_dashboard_session') ?? 'life_dashboard_session');
    session_set_cookie_params([
        'lifetime' => $sessionLifetime,
        'path' => '/',
        'secure' => Config::get('APP_ENV', 'production') === 'production',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}
