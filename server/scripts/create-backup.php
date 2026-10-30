<?php

declare(strict_types=1);

use Life\BackupManager;
use Life\Database;
use Life\DateTimes;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
$manager = new BackupManager();
$users = $db->query('SELECT id, timezone FROM users ORDER BY id')->fetchAll();
$weekday = (int) gmdate('N');

foreach ($users as $user) {
    $record = $manager->create($db, (int) $user['id'], DateTimes::safeTimezone((string) $user['timezone']), 'daily');
    echo "Daily backup created: {$record['fileName']}\n";
    if ($weekday === 7) {
        $weekly = $manager->create($db, (int) $user['id'], DateTimes::safeTimezone((string) $user['timezone']), 'weekly');
        echo "Weekly backup created: {$weekly['fileName']}\n";
    }
}
