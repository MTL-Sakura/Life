<?php

declare(strict_types=1);

use Life\BackupManager;
use Life\Config;
use Life\Database;
use Life\DateTimes;
use Life\Mailer;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
$manager = new BackupManager();
$users = $db->query('SELECT id, email, timezone FROM users ORDER BY id')->fetchAll();
$weekday = (int) gmdate('N');

foreach ($users as $user) {
    $timezone = DateTimes::safeTimezone((string) $user['timezone']);
    $record = $manager->create($db, (int) $user['id'], $timezone, 'daily');
    echo "Daily backup created: {$record['fileName']}\n";
    if ($weekday === 7) {
        $weekly = $manager->create($db, (int) $user['id'], $timezone, 'weekly');
        echo "Weekly backup created: {$weekly['fileName']}\n";
        sendOffsiteCopy($manager, $db, $user, $weekly);
    }
}

/**
 * The backups above live on the same disk as the database. Once a week a
 * compressed copy is e-mailed to the account address, so a lost server does
 * not take the backups with it. Set BACKUP_EMAIL=false in .env to turn it off.
 */
function sendOffsiteCopy(BackupManager $manager, PDO $db, array $user, array $record): void
{
    if (!Config::bool('BACKUP_EMAIL', true) || trim((string) $user['email']) === '') {
        return;
    }
    try {
        $json = json_encode($manager->stored($db, (int) $user['id'], (int) $record['id']), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $compressed = gzencode($json, 9);
        if ($compressed === false) {
            throw new RuntimeException('Unable to compress backup.');
        }
        $fileName = preg_replace('/\.json$/', '.json.gz', (string) $record['fileName']);
        (new Mailer())->send(
            (string) $user['email'],
            '人生看板每周备份',
            '<h2 style="margin:0 0 12px;font-size:21px">本周数据备份</h2>'
                . '<p style="color:#686c64">附件是看板数据的完整备份，可以在“设置 → 数据 → 恢复备份”中恢复。请妥善保管这封邮件。</p>',
            '附件是人生看板本周的完整数据备份，可以在“设置 → 数据 → 恢复备份”中恢复。',
            [$fileName => $compressed],
        );
        echo "Weekly backup e-mailed: {$fileName}\n";
    } catch (Throwable $error) {
        error_log("Off-site backup e-mail for user {$user['id']} failed: {$error}");
        echo "Weekly backup e-mail failed (see error log)\n";
    }
}
