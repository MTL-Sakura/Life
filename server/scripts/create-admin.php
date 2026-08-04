<?php

declare(strict_types=1);

use Life\Config;
use Life\Database;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
$username = Config::require('ADMIN_USERNAME');
$password = Config::require('ADMIN_PASSWORD');
$email = Config::require('ADMIN_EMAIL');
$displayName = Config::get('ADMIN_DISPLAY_NAME', 'Sakura') ?? 'Sakura';
$timezone = Config::get('APP_TIMEZONE', 'Europe/Berlin') ?? 'Europe/Berlin';

if (strlen($password) < 10) {
    throw new RuntimeException('ADMIN_PASSWORD must contain at least 10 characters.');
}

$statement = $db->prepare(
    'INSERT INTO users (username, password_hash, email, display_name, timezone)
     VALUES (:username, :password_hash, :email, :display_name, :timezone)
     ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), timezone = VALUES(timezone)'
);
$statement->execute([
    'username' => $username,
    'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    'email' => $email,
    'display_name' => $displayName,
    'timezone' => $timezone,
]);

$userStatement = $db->prepare('SELECT id FROM users WHERE username = ?');
$userStatement->execute([$username]);
$userId = (int) $userStatement->fetchColumn();

$settings = $db->prepare('INSERT IGNORE INTO user_settings (user_id) VALUES (?)');
$settings->execute([$userId]);

$category = $db->prepare('INSERT IGNORE INTO categories (user_id, name, color) VALUES (?, ?, ?)');
foreach ([
    ['工作', '#496d5b'],
    ['学习', '#b96552'],
    ['健康', '#58748f'],
    ['成长', '#a1843e'],
    ['生活', '#7a6b87'],
] as [$name, $color]) {
    $category->execute([$userId, $name, $color]);
}

echo "Administrator account is ready: {$username}\n";
