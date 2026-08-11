<?php

declare(strict_types=1);

use Life\Database;
use Life\Mailer;
use Life\PushNotifier;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
$mailer = new Mailer();
$nowUtc = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$push = null;
if (PushNotifier::configured()) {
    try {
        $push = new PushNotifier();
    } catch (Throwable $error) {
        error_log('Web Push initialization failed: ' . $error);
    }
}

sendTaskReminders($db, $mailer, $push, $nowUtc);
sendDailySummaries($db, $mailer, $push, $nowUtc);
sendOverdueSummaries($db, $mailer, $push, $nowUtc);

function sendTaskReminders(PDO $db, Mailer $mailer, ?PushNotifier $push, DateTimeImmutable $nowUtc): void
{
    $statement = $db->prepare(
        'SELECT tasks.id, tasks.user_id, tasks.title, tasks.start_at, tasks.reminder_at, tasks.reminder_sent_at,
                tasks.push_reminder_sent_at, users.email, users.timezone,
                user_settings.email_reminders, user_settings.push_task_reminders
         FROM tasks
         INNER JOIN users ON users.id = tasks.user_id
         INNER JOIN user_settings ON user_settings.user_id = users.id
         WHERE tasks.reminder_at IS NOT NULL
           AND tasks.reminder_at <= ?
           AND tasks.reminder_at >= ?
           AND tasks.status NOT IN ("completed", "cancelled")
           AND ((user_settings.email_reminders = 1 AND tasks.reminder_sent_at IS NULL)
             OR (user_settings.push_task_reminders = 1 AND tasks.push_reminder_sent_at IS NULL))
         ORDER BY tasks.reminder_at LIMIT 50'
    );
    $statement->execute([
        $nowUtc->format('Y-m-d H:i:s'),
        $nowUtc->modify('-24 hours')->format('Y-m-d H:i:s'),
    ]);

    $markEmailSent = $db->prepare('UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL');
    $markPushSent = $db->prepare('UPDATE tasks SET push_reminder_sent_at = ? WHERE id = ? AND push_reminder_sent_at IS NULL');
    foreach ($statement->fetchAll() as $task) {
        $localDate = $nowUtc->setTimezone(new DateTimeZone($task['timezone']))->format('Y-m-d');
        if (dayClosed($db, (int) $task['user_id'], $localDate)) {
            continue;
        }
        $start = (new DateTimeImmutable($task['start_at'], new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone($task['timezone']));
        $time = $start->format('H:i');
        $title = htmlspecialchars($task['title'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

        $reminderAge = $nowUtc->getTimestamp() - (new DateTimeImmutable($task['reminder_at'], new DateTimeZone('UTC')))->getTimestamp();
        if ((bool) $task['push_task_reminders'] && $task['push_reminder_sent_at'] === null && $reminderAge > 15 * 60) {
            $markPushSent->execute([$nowUtc->format('Y-m-d H:i:s'), (int) $task['id']]);
            echo "Stale task push skipped: {$task['id']}\n";
        } elseif ((bool) $task['push_task_reminders'] && $task['push_reminder_sent_at'] === null && $push !== null) {
            try {
                $result = $push->sendToUser($db, (int) $task['user_id'], [
                    'title' => "{$time} · {$task['title']}",
                    'body' => '快到计划时间了。先打开任务，只做第一步。',
                    'url' => '/?task=' . (int) $task['id'],
                    'tag' => 'task-' . (int) $task['id'] . '-' . $start->format('YmdHi'),
                ]);
                if ($result['sent'] > 0) {
                    $markPushSent->execute([$nowUtc->format('Y-m-d H:i:s'), (int) $task['id']]);
                    echo "Task push sent: {$task['id']}\n";
                }
            } catch (Throwable $error) {
                error_log("Task push {$task['id']} failed: {$error}");
            }
        }

        if ((bool) $task['email_reminders'] && $task['reminder_sent_at'] === null) {
            try {
                $mailer->send(
                    $task['email'],
                    "{$time} · {$task['title']}",
                    "<h2 style=\"margin:0 0 12px;font-size:21px\">{$title}</h2><p style=\"margin:0;color:#686c64\">计划在今天 {$time} 开始。</p>",
                    "{$task['title']}，计划在今天 {$time} 开始。",
                );
                $markEmailSent->execute([$nowUtc->format('Y-m-d H:i:s'), (int) $task['id']]);
                echo "Task email sent: {$task['id']}\n";
            } catch (Throwable $error) {
                error_log("Task email {$task['id']} failed: {$error}");
            }
        }
    }
}

function sendDailySummaries(PDO $db, Mailer $mailer, ?PushNotifier $push, DateTimeImmutable $nowUtc): void
{
    $users = $db->query(
        'SELECT users.id, users.email, users.display_name, users.timezone,
                user_settings.daily_summary, user_settings.push_daily_summary, user_settings.daily_summary_time
         FROM users INNER JOIN user_settings ON user_settings.user_id = users.id
         WHERE user_settings.daily_summary = 1 OR user_settings.push_daily_summary = 1'
    )->fetchAll();

    foreach ($users as $user) {
        $localNow = $nowUtc->setTimezone(new DateTimeZone($user['timezone']));
        if (!withinFiveMinuteWindow($localNow, $user['daily_summary_time'])) {
            continue;
        }
        $reference = $localNow->format('Y-m-d');
        if (dayClosed($db, (int) $user['id'], $reference)) {
            continue;
        }

        [$startUtc, $endUtc] = localDayBounds($localNow);
        $summary = $db->prepare(
            'SELECT COUNT(*) AS total, SUM(status = "completed") AS completed,
                    COALESCE(SUM(CASE WHEN status = "completed" THEN estimated_minutes ELSE 0 END), 0) AS minutes
             FROM tasks WHERE user_id = ? AND (start_at >= ? AND start_at < ? OR completed_at >= ? AND completed_at < ?)'
        );
        $summary->execute([(int) $user['id'], $startUtc, $endUtc, $startUtc, $endUtc]);
        $row = $summary->fetch() ?: [];
        $completed = (int) ($row['completed'] ?? 0);
        $total = (int) ($row['total'] ?? 0);
        $minutes = (int) ($row['minutes'] ?? 0);
        $hours = intdiv($minutes, 60);
        $remainingMinutes = $minutes % 60;

        if ((bool) $user['push_daily_summary'] && $push !== null && !notificationExists($db, (int) $user['id'], 'daily_summary', 'push', $reference)) {
            try {
                $result = $push->sendToUser($db, (int) $user['id'], [
                    'title' => "今日收尾 · 完成 {$completed} 项",
                    'body' => "今天完成 {$completed}/{$total} 项。没有做完的事情可以重新安排。",
                    'url' => '/today',
                    'tag' => 'daily-summary-' . $reference,
                ]);
                if ($result['sent'] > 0) {
                    recordNotification($db, (int) $user['id'], 'daily_summary', 'push', $reference, $nowUtc);
                    echo "Daily summary push sent: {$user['id']}\n";
                }
            } catch (Throwable $error) {
                error_log("Daily summary push {$user['id']} failed: {$error}");
            }
        }

        if ((bool) $user['daily_summary'] && !notificationExists($db, (int) $user['id'], 'daily_summary', 'email', $reference)) {
            try {
                $mailer->send(
                    $user['email'],
                    "今日收尾 · 完成 {$completed} 项",
                    '<h2 style="margin:0 0 16px;font-size:21px">今天辛苦了</h2>'
                        . "<p style=\"color:#686c64\">今天完成了 <strong>{$completed}/{$total}</strong> 项任务，投入 {$hours} 小时 {$remainingMinutes} 分钟。</p>"
                        . '<p style="color:#686c64">没有做完的事情可以重新安排，今天到这里就很好。</p>',
                    "今天完成了 {$completed}/{$total} 项任务，投入 {$hours} 小时 {$remainingMinutes} 分钟。",
                );
                recordNotification($db, (int) $user['id'], 'daily_summary', 'email', $reference, $nowUtc);
                echo "Daily summary email sent: {$user['id']}\n";
            } catch (Throwable $error) {
                error_log("Daily summary email {$user['id']} failed: {$error}");
            }
        }
    }
}

function sendOverdueSummaries(PDO $db, Mailer $mailer, ?PushNotifier $push, DateTimeImmutable $nowUtc): void
{
    $users = $db->query(
        'SELECT users.id, users.email, users.timezone, user_settings.overdue_reminder, user_settings.push_overdue_reminder
         FROM users INNER JOIN user_settings ON user_settings.user_id = users.id
         WHERE user_settings.overdue_reminder = 1 OR user_settings.push_overdue_reminder = 1'
    )->fetchAll();

    foreach ($users as $user) {
        $localNow = $nowUtc->setTimezone(new DateTimeZone($user['timezone']));
        if (!withinFiveMinuteWindow($localNow, '09:00:00')) {
            continue;
        }
        $reference = $localNow->format('Y-m-d');
        $statement = $db->prepare(
            'SELECT title FROM tasks WHERE user_id = ? AND due_at < ? AND status NOT IN ("completed", "cancelled") ORDER BY due_at LIMIT 8'
        );
        $statement->execute([(int) $user['id'], $nowUtc->format('Y-m-d H:i:s')]);
        $tasks = $statement->fetchAll(PDO::FETCH_COLUMN);
        if ($tasks === []) {
            if ((bool) $user['push_overdue_reminder']) recordNotification($db, (int) $user['id'], 'overdue_summary', 'push', $reference, $nowUtc);
            if ((bool) $user['overdue_reminder']) recordNotification($db, (int) $user['id'], 'overdue_summary', 'email', $reference, $nowUtc);
            continue;
        }

        if ((bool) $user['push_overdue_reminder'] && $push !== null && !notificationExists($db, (int) $user['id'], 'overdue_summary', 'push', $reference)) {
            try {
                $result = $push->sendToUser($db, (int) $user['id'], [
                    'title' => '有任务需要重新安排',
                    'body' => '有 ' . count($tasks) . ' 项逾期任务，今天找个时间决定它们的去向。',
                    'url' => '/inbox',
                    'tag' => 'overdue-summary-' . $reference,
                ]);
                if ($result['sent'] > 0) {
                    recordNotification($db, (int) $user['id'], 'overdue_summary', 'push', $reference, $nowUtc);
                    echo "Overdue summary push sent: {$user['id']}\n";
                }
            } catch (Throwable $error) {
                error_log("Overdue summary push {$user['id']} failed: {$error}");
            }
        }

        if ((bool) $user['overdue_reminder'] && !notificationExists($db, (int) $user['id'], 'overdue_summary', 'email', $reference)) {
            $items = implode('', array_map(
                static fn (string $title): string => '<li style="margin:8px 0">' . htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</li>',
                $tasks,
            ));
            try {
                $mailer->send(
                    $user['email'],
                    '需要重新安排的任务',
                    '<h2 style="margin:0 0 12px;font-size:21px">有 ' . count($tasks) . " 项任务需要决定去向</h2><ul style=\"padding-left:20px;color:#686c64\">{$items}</ul>",
                    '有 ' . count($tasks) . ' 项逾期任务需要重新安排：' . implode('、', $tasks),
                );
                recordNotification($db, (int) $user['id'], 'overdue_summary', 'email', $reference, $nowUtc);
                echo "Overdue summary email sent: {$user['id']}\n";
            } catch (Throwable $error) {
                error_log("Overdue summary email {$user['id']} failed: {$error}");
            }
        }
    }
}

function withinFiveMinuteWindow(DateTimeImmutable $now, string $configuredTime): bool
{
    $scheduled = new DateTimeImmutable($now->format('Y-m-d') . ' ' . $configuredTime, $now->getTimezone());
    $difference = $now->getTimestamp() - $scheduled->getTimestamp();
    return $difference >= 0 && $difference < 300;
}

function localDayBounds(DateTimeImmutable $localNow): array
{
    $start = $localNow->setTime(0, 0);
    $end = $start->modify('+1 day');
    $utc = new DateTimeZone('UTC');
    return [
        $start->setTimezone($utc)->format('Y-m-d H:i:s'),
        $end->setTimezone($utc)->format('Y-m-d H:i:s'),
    ];
}

function notificationExists(PDO $db, int $userId, string $type, string $channel, string $reference): bool
{
    $statement = $db->prepare('SELECT 1 FROM notification_logs WHERE user_id = ? AND type = ? AND channel = ? AND reference_key = ? LIMIT 1');
    $statement->execute([$userId, $type, $channel, $reference]);
    return (bool) $statement->fetchColumn();
}

function dayClosed(PDO $db, int $userId, string $localDate): bool
{
    $statement = $db->prepare('SELECT 1 FROM daily_checkins WHERE user_id = ? AND local_date = ? AND closed_at IS NOT NULL LIMIT 1');
    $statement->execute([$userId, $localDate]);
    return $statement->fetchColumn() !== false;
}

function recordNotification(PDO $db, int $userId, string $type, string $channel, string $reference, DateTimeImmutable $sentAt): void
{
    $statement = $db->prepare('INSERT IGNORE INTO notification_logs (user_id, type, channel, reference_key, sent_at) VALUES (?, ?, ?, ?, ?)');
    $statement->execute([$userId, $type, $channel, $reference, $sentAt->format('Y-m-d H:i:s')]);
}
