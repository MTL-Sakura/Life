<?php

declare(strict_types=1);

// Moves open recurring occurrences that were shifted by the old UTC-based
// generation back to their wall-clock time. Safe to run on every deploy.

use Life\Database;
use Life\DateTimes;
use Life\RecurringTasks;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
foreach ($db->query('SELECT id, timezone FROM users ORDER BY id')->fetchAll() as $user) {
    $count = RecurringTasks::repairDst($db, (int) $user['id'], DateTimes::safeTimezone($user['timezone']));
    echo "Recurring tasks repaired for user {$user['id']}: {$count}\n";
}
