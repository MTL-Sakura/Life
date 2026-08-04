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
    session_name(Config::get('SESSION_NAME', 'life_dashboard_session') ?? 'life_dashboard_session');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => Config::get('APP_ENV', 'production') === 'production',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}
