<?php

declare(strict_types=1);

use Life\Auth;
use Life\AiPlanner;
use Life\AiPlannerException;
use Life\BackupManager;
use Life\Config;
use Life\Database;
use Life\DateTimes;
use Life\Http;
use Life\Mailer;
use Life\PlanImporter;
use Life\PlanImportException;
use Life\PushNotifier;
use Life\Views;

require dirname(__DIR__, 2) . '/server/bootstrap.php';

set_exception_handler(static function (Throwable $error): void {
    error_log((string) $error);
    Http::json(['error' => '服务器暂时无法处理请求，请稍后重试。'], 500);
});

$db = Database::connection();
$action = (string) ($_GET['action'] ?? 'session');

if ($action === 'login') {
    Http::requireMethod('POST');
    $input = Http::input();
    $username = trim((string) ($input['username'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    $user = Auth::login($db, $username, $password);
    if ($user === null) {
        Http::json(['error' => '用户名或密码不正确。'], 422);
    }
    Http::json(['user' => userView($user), 'csrfToken' => Auth::csrfToken()]);
}

if ($action === 'session') {
    Http::requireMethod('GET');
    $user = Auth::currentUser($db);
    Http::json([
        'authenticated' => $user !== null,
        'user' => $user ? userView($user) : null,
        'csrfToken' => $user ? Auth::csrfToken() : null,
    ]);
}

$user = Auth::requireUser($db);
$userId = (int) $user['id'];
$timezone = (string) $user['timezone'];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Auth::assertCsrf();
}

switch ($action) {
    case 'logout':
        Http::requireMethod('POST');
        Auth::logout();
        Http::json(['ok' => true]);

    case 'bootstrap':
        Http::requireMethod('GET');
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'push.config':
        Http::requireMethod('GET');
        $subscriptionCount = $db->prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?');
        $subscriptionCount->execute([$userId]);
        Http::json([
            'configured' => PushNotifier::configured(),
            'publicKey' => PushNotifier::configured() ? Config::get('WEB_PUSH_PUBLIC_KEY', '') : '',
            'subscriptionCount' => (int) $subscriptionCount->fetchColumn(),
        ]);

    case 'push.subscribe':
        Http::requireMethod('POST');
        $input = Http::input();
        $subscription = is_array($input['subscription'] ?? null) ? $input['subscription'] : [];
        $keys = is_array($subscription['keys'] ?? null) ? $subscription['keys'] : [];
        $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
        $publicKey = trim((string) ($keys['p256dh'] ?? ''));
        $authToken = trim((string) ($keys['auth'] ?? ''));
        $contentEncoding = trim((string) ($input['contentEncoding'] ?? 'aes128gcm'));
        $deviceName = trim((string) ($input['deviceName'] ?? '浏览器设备'));
        $endpointParts = parse_url($endpoint);
        if (($endpointParts['scheme'] ?? '') !== 'https' || $publicKey === '' || $authToken === '' || strlen($endpoint) > 2048) {
            Http::json(['error' => '浏览器推送订阅内容不完整。'], 422);
        }
        if (!in_array($contentEncoding, ['aes128gcm', 'aesgcm'], true)) {
            $contentEncoding = 'aes128gcm';
        }
        $deviceName = function_exists('mb_substr') ? mb_substr($deviceName, 0, 100) : substr($deviceName, 0, 100);
        $userAgent = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
        $db->prepare(
            'INSERT INTO push_subscriptions
                (user_id, endpoint, endpoint_hash, public_key, auth_token, content_encoding, device_name, user_agent, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), public_key = VALUES(public_key),
                auth_token = VALUES(auth_token), content_encoding = VALUES(content_encoding), device_name = VALUES(device_name),
                user_agent = VALUES(user_agent), last_seen_at = UTC_TIMESTAMP(), failure_count = 0'
        )->execute([$userId, $endpoint, hash('sha256', $endpoint, true), $publicKey, $authToken, $contentEncoding, $deviceName, $userAgent]);
        Http::json(['ok' => true], 201);

    case 'push.unsubscribe':
        Http::requireMethod('DELETE', 'POST');
        $input = Http::input();
        $endpoint = trim((string) ($input['endpoint'] ?? ''));
        if ($endpoint !== '') {
            $db->prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?')
                ->execute([$userId, hash('sha256', $endpoint, true)]);
        }
        Http::json(['ok' => true]);

    case 'push.test':
        Http::requireMethod('POST');
        $input = Http::input();
        $endpoint = trim((string) ($input['endpoint'] ?? ''));
        if ($endpoint === '') {
            Http::json(['error' => '当前设备尚未开启浏览器推送。'], 422);
        }
        try {
            $result = (new PushNotifier())->sendToEndpoint($db, $userId, $endpoint, [
                'title' => '人生看板通知测试',
                'body' => '连接成功。以后的任务提醒会直接出现在这里。',
                'url' => '/settings/reminders',
                'tag' => 'push-test-' . gmdate('YmdHis'),
            ]);
            if ($result['sent'] < 1) {
                Http::json(['error' => '测试通知没有送达，请重新开启通知后再试。'], 502);
            }
        } catch (Throwable $error) {
            error_log((string) $error);
            Http::json(['error' => '测试通知发送失败，请检查推送配置或服务器网络。'], 502);
        }
        Http::json(['ok' => true]);

    case 'tasks.create':
        Http::requireMethod('POST');
        $input = Http::input();
        $title = trim((string) ($input['title'] ?? ''));
        if ($title === '') {
            Http::json(['error' => '任务标题不能为空。'], 422);
        }

        $startAt = DateTimes::toUtc(nullableString($input['startAt'] ?? null), $timezone);
        $endAt = DateTimes::toUtc(nullableString($input['endAt'] ?? null), $timezone);
        $dueAt = DateTimes::toUtc(nullableString($input['dueAt'] ?? null), $timezone);
        $reminderMinutes = nullableInt($input['reminderMinutes'] ?? null);
        $reminderAt = reminderAt($startAt, $reminderMinutes);
        $status = $startAt === null ? 'inbox' : validStatus((string) ($input['status'] ?? 'planned'));

        $recurrenceRule = nullableString($input['recurrenceRule'] ?? null);
        $statement = $db->prepare(
            'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, is_focus, recurrence_rule, schedule_mode, window_start, window_end, reminder_minutes, reminder_at)
             VALUES (:user_id, :project_id, :category_id, :title, :notes, :status, :priority, :start_at, :end_at, :due_at, :estimated_minutes, :is_focus, :recurrence_rule, :schedule_mode, :window_start, :window_end, :reminder_minutes, :reminder_at)'
        );
        $statement->execute([
            'user_id' => $userId,
            'project_id' => nullableInt($input['projectId'] ?? null),
            'category_id' => nullableInt($input['categoryId'] ?? null),
            'title' => $title,
            'notes' => trim((string) ($input['notes'] ?? '')),
            'status' => $status,
            'priority' => validPriority((string) ($input['priority'] ?? 'medium')),
            'start_at' => $startAt,
            'end_at' => $endAt,
            'due_at' => $dueAt,
            'estimated_minutes' => max(1, min(1440, (int) ($input['duration'] ?? 30))),
            'is_focus' => (int) (bool) ($input['isFocus'] ?? false),
            'recurrence_rule' => $recurrenceRule,
            'schedule_mode' => validScheduleMode((string) ($input['scheduleMode'] ?? ($startAt === null ? 'flexible' : 'fixed'))),
            'window_start' => validTime(nullableString($input['windowStart'] ?? null)),
            'window_end' => validTime(nullableString($input['windowEnd'] ?? null)),
            'reminder_minutes' => $reminderMinutes,
            'reminder_at' => $reminderAt,
        ]);
        $taskId = (int) $db->lastInsertId();
        if ($recurrenceRule !== null) {
            $seriesId = createTaskSeries($db, $userId, $recurrenceRule);
            $db->prepare('UPDATE tasks SET recurrence_series_id = ? WHERE id = ?')->execute([$seriesId, $taskId]);
        }
        $subtaskStatement = $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) VALUES (?, ?, ?, ?)');
        foreach (normalizedSubtasks($input['subtasks'] ?? []) as $position => $subtask) {
            if ($subtask['title'] !== '') {
                $subtaskStatement->execute([$taskId, $subtask['title'], (int) $subtask['completed'], $position]);
            }
        }
        Http::json(['task' => findTask($db, $taskId, $userId, $timezone)], 201);

    case 'tasks.update':
        Http::requireMethod('PATCH', 'POST');
        $input = Http::input();
        $taskId = (int) ($input['id'] ?? 0);
        $current = ownedRow($db, 'tasks', $taskId, $userId);
        $updates = [];
        $params = [];

        $simpleFields = [
            'title' => 'title',
            'notes' => 'notes',
            'projectId' => 'project_id',
            'categoryId' => 'category_id',
            'duration' => 'estimated_minutes',
            'isFocus' => 'is_focus',
            'recurrenceRule' => 'recurrence_rule',
            'scheduleMode' => 'schedule_mode',
            'windowStart' => 'window_start',
            'windowEnd' => 'window_end',
            'reminderMinutes' => 'reminder_minutes',
        ];
        foreach ($simpleFields as $inputKey => $column) {
            if (!array_key_exists($inputKey, $input)) {
                continue;
            }
            $value = $input[$inputKey];
            if (in_array($inputKey, ['projectId', 'categoryId', 'reminderMinutes'], true)) {
                $value = nullableInt($value);
            } elseif ($inputKey === 'duration') {
                $value = max(1, min(1440, (int) $value));
            } elseif ($inputKey === 'isFocus') {
                $value = (int) (bool) $value;
            } elseif ($inputKey === 'recurrenceRule') {
                $value = nullableString($value);
            } elseif ($inputKey === 'scheduleMode') {
                $value = validScheduleMode((string) $value);
            } elseif (in_array($inputKey, ['windowStart', 'windowEnd'], true)) {
                $value = validTime(nullableString($value));
            } else {
                $value = trim((string) $value);
            }
            $updates[$column] = $value;
        }
        if (array_key_exists('title', $updates) && $updates['title'] === '') {
            Http::json(['error' => '任务标题不能为空。'], 422);
        }

        if (array_key_exists('priority', $input)) {
            $updates['priority'] = validPriority((string) $input['priority']);
        }
        if (array_key_exists('status', $input)) {
            $updates['status'] = validStatus((string) $input['status']);
        }
        foreach (['startAt' => 'start_at', 'endAt' => 'end_at', 'dueAt' => 'due_at'] as $inputKey => $column) {
            if (array_key_exists($inputKey, $input)) {
                $updates[$column] = DateTimes::toUtc(nullableString($input[$inputKey]), $timezone);
            }
        }
        if (array_key_exists('startAt', $input)
            && !array_key_exists('status', $input)
            && !array_key_exists('completed', $input)
            && $current['status'] !== 'completed') {
            $updates['status'] = $updates['start_at'] === null ? 'inbox' : 'planned';
        }
        if (array_key_exists('completed', $input)) {
            $completed = (bool) $input['completed'];
            $updates['status'] = $completed ? 'completed' : (($current['start_at'] ?? null) ? 'planned' : 'inbox');
            $updates['completed_at'] = $completed ? gmdate('Y-m-d H:i:s') : null;
            if ($completed && array_key_exists('actualMinutes', $input)) {
                $updates['actual_minutes'] = max(1, min(1440, (int) $input['actualMinutes']));
            } elseif (!$completed) {
                $updates['actual_minutes'] = null;
            }
        }

        $effectiveStart = array_key_exists('start_at', $updates) ? $updates['start_at'] : $current['start_at'];
        $effectiveReminderMinutes = array_key_exists('reminder_minutes', $updates) ? $updates['reminder_minutes'] : $current['reminder_minutes'];
        if (array_key_exists('start_at', $updates) || array_key_exists('reminder_minutes', $updates)) {
            $updates['reminder_at'] = reminderAt($effectiveStart, $effectiveReminderMinutes === null ? null : (int) $effectiveReminderMinutes);
            $updates['reminder_sent_at'] = null;
            $updates['push_reminder_sent_at'] = null;
        }

        $subtasksChanged = array_key_exists('subtasks', $input);
        if ($updates === [] && !$subtasksChanged) {
            Http::json(['task' => findTask($db, $taskId, $userId, $timezone)]);
        }

        $updateScope = ($input['updateScope'] ?? 'single') === 'future' ? 'future' : 'single';
        $recurringEditFields = ['title', 'notes', 'projectId', 'categoryId', 'duration', 'isFocus', 'recurrenceRule', 'scheduleMode', 'windowStart', 'windowEnd', 'reminderMinutes', 'priority', 'startAt', 'endAt', 'dueAt', 'subtasks'];
        $isRecurringEdit = !array_key_exists('completed', $input)
            && nullableString($current['recurrence_rule'] ?? null) !== null
            && array_intersect($recurringEditFields, array_keys($input)) !== [];
        $shouldGenerateNext = array_key_exists('completed', $input)
            && (bool) $input['completed']
            && $current['status'] !== 'completed'
            && nullableString($current['recurrence_rule'] ?? null) !== null;
        $nextTaskId = null;
        $db->beginTransaction();
        try {
            if (($completed ?? false) === true) {
                endFocusSessionForEvening($db, $taskId, gmdate('Y-m-d H:i:s'));
                if (!array_key_exists('actual_minutes', $updates)) {
                    $focusMinutes = recordedFocusMinutes($db, $taskId);
                    $updates['actual_minutes'] = $focusMinutes > 0 ? $focusMinutes : (int) $current['estimated_minutes'];
                }
            }
            if ($isRecurringEdit && $updateScope === 'single') {
                $nextTaskId = createNextRecurringTask($db, $current, $timezone);
                $updates['recurrence_rule'] = null;
                $updates['recurrence_series_id'] = null;
            } elseif ($isRecurringEdit && $updateScope === 'future') {
                $seriesId = nullableInt($current['recurrence_series_id'] ?? null);
                if ($seriesId !== null) {
                    $moment = $current['start_at'] ?? $current['due_at'] ?? $current['end_at'] ?? '9999-12-31 23:59:59';
                    $db->prepare('DELETE FROM tasks WHERE user_id = ? AND recurrence_series_id = ? AND id != ? AND status != "completed" AND COALESCE(start_at, due_at, end_at) >= ?')
                        ->execute([$userId, $seriesId, $taskId, $moment]);
                    $effectiveRule = array_key_exists('recurrence_rule', $updates) ? $updates['recurrence_rule'] : $current['recurrence_rule'];
                    if ($effectiveRule !== null) {
                        $db->prepare('UPDATE task_series SET recurrence_rule = ? WHERE id = ? AND user_id = ?')->execute([$effectiveRule, $seriesId, $userId]);
                    } else {
                        $updates['recurrence_series_id'] = null;
                    }
                }
            }
            if ($updates !== []) {
                foreach ($updates as $value) {
                    $params[] = $value;
                }
                $params[] = $taskId;
                $params[] = $userId;
                $sql = 'UPDATE tasks SET ' . implode(', ', array_map(static fn (string $column): string => "{$column} = ?", array_keys($updates))) . ' WHERE id = ? AND user_id = ?';
                $db->prepare($sql)->execute($params);
            }
            if ($subtasksChanged) {
                syncTaskSubtasks($db, $taskId, (array) ($input['subtasks'] ?? []));
            }
            if (array_intersect(['startAt', 'endAt', 'duration', 'scheduleMode', 'windowStart', 'windowEnd'], array_keys($input)) !== []) {
                $db->prepare('DELETE FROM task_schedule_blocks WHERE task_id = ? AND user_id = ?')->execute([$taskId, $userId]);
            }
            if ($shouldGenerateNext) {
                $nextTaskId = createNextRecurringTask($db, ownedRow($db, 'tasks', $taskId, $userId), $timezone);
            }
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }

        $response = ['task' => findTask($db, $taskId, $userId, $timezone)];
        if ($nextTaskId !== null) {
            $response['nextTask'] = findTask($db, $nextTaskId, $userId, $timezone);
        }
        Http::json($response);

    case 'tasks.delete':
        Http::requireMethod('DELETE', 'POST');
        $input = Http::input();
        $statement = $db->prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?');
        $statement->execute([(int) ($input['id'] ?? 0), $userId]);
        Http::json(['ok' => true]);

    case 'tasks.recurrence.skip':
        Http::requireMethod('POST');
        $input = Http::input();
        $taskId = (int) ($input['id'] ?? 0);
        $task = ownedRow($db, 'tasks', $taskId, $userId);
        if (nullableString($task['recurrence_rule'] ?? null) === null) {
            Http::json(['error' => '这个任务不是循环任务。'], 422);
        }
        $db->beginTransaction();
        try {
            createNextRecurringTask($db, $task, $timezone);
            $db->prepare("UPDATE tasks SET status = 'cancelled', occurrence_state = 'skipped', reminder_at = NULL, reminder_sent_at = NULL, push_reminder_sent_at = NULL WHERE id = ? AND user_id = ?")
                ->execute([$taskId, $userId]);
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'tasks.recurrence.pause':
        Http::requireMethod('POST');
        $input = Http::input();
        $taskId = (int) ($input['id'] ?? 0);
        $pausedUntil = (string) ($input['pausedUntil'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $pausedUntil)) {
            Http::json(['error' => '恢复日期格式不正确。'], 422);
        }
        $task = ownedRow($db, 'tasks', $taskId, $userId);
        $seriesId = nullableInt($task['recurrence_series_id'] ?? null);
        if ($seriesId === null) {
            Http::json(['error' => '这个任务还没有循环系列。'], 422);
        }
        $today = new DateTimeImmutable('today', new DateTimeZone($timezone));
        $resumeDate = new DateTimeImmutable($pausedUntil, new DateTimeZone($timezone));
        if ($resumeDate <= $today) {
            Http::json(['error' => '恢复日期必须晚于今天。'], 422);
        }
        $resumeUtc = $resumeDate->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $db->beginTransaction();
        try {
            $db->prepare('UPDATE task_series SET paused_until = ? WHERE id = ? AND user_id = ?')->execute([$pausedUntil, $seriesId, $userId]);
            $db->prepare(
                "UPDATE tasks SET status = 'cancelled', occurrence_state = 'skipped', reminder_at = NULL, reminder_sent_at = NULL, push_reminder_sent_at = NULL
                 WHERE user_id = ? AND recurrence_series_id = ? AND status != 'completed'
                   AND COALESCE(start_at, due_at, end_at) < ?"
            )->execute([$userId, $seriesId, $resumeUtc]);
            ensureRecurringTaskContinuity($db, $userId, $timezone, $pausedUntil);
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'tasks.subtask':
        Http::requireMethod('PATCH', 'POST');
        $input = Http::input();
        $taskId = (int) ($input['taskId'] ?? 0);
        $subtaskId = (int) ($input['id'] ?? 0);
        $statement = $db->prepare(
            'SELECT subtasks.id FROM subtasks INNER JOIN tasks ON tasks.id = subtasks.task_id
             WHERE subtasks.id = ? AND subtasks.task_id = ? AND tasks.user_id = ? LIMIT 1'
        );
        $statement->execute([$subtaskId, $taskId, $userId]);
        if (!$statement->fetchColumn()) {
            Http::json(['error' => '子任务不存在。'], 404);
        }
        $db->prepare('UPDATE subtasks SET completed = ? WHERE id = ?')->execute([
            (int) (bool) ($input['completed'] ?? false),
            $subtaskId,
        ]);
        Http::json(['task' => findTask($db, $taskId, $userId, $timezone)]);

    case 'rescue.start':
        Http::requireMethod('POST');
        $input = Http::input();
        $taskId = (int) ($input['taskId'] ?? 0);
        $reason = (string) ($input['reason'] ?? '');
        $step = trim((string) ($input['step'] ?? ''));
        $durationMinutes = (int) ($input['durationMinutes'] ?? 5);
        if (!in_array($reason, ['low_energy', 'too_big', 'unclear', 'not_convenient'], true)) {
            Http::json(['error' => '请选择现在难以开始的原因。'], 422);
        }
        $stepLength = function_exists('mb_strlen') ? mb_strlen($step) : strlen($step);
        if ($stepLength < 1 || $stepLength > 255 || !in_array($durationMinutes, [2, 5, 10], true)) {
            Http::json(['error' => '请填写 255 字以内的最小动作，并选择 2、5 或 10 分钟。'], 422);
        }
        $task = ownedRow($db, 'tasks', $taskId, $userId);
        if (in_array($task['status'], ['completed', 'cancelled'], true)) {
            Http::json(['error' => '已经结束的任务不能进入救援模式。'], 409);
        }
        $rescueError = startRescueSession($db, $task, $userId, $reason, $step, $durationMinutes);
        if ($rescueError !== null) {
            Http::json(['error' => $rescueError['message']], $rescueError['status']);
        }
        Http::json(['task' => findTask($db, $taskId, $userId, $timezone)], 201);

    case 'rescue.finish':
        Http::requireMethod('POST');
        $input = Http::input();
        $taskId = (int) ($input['taskId'] ?? 0);
        $outcome = (string) ($input['outcome'] ?? '');
        if (!in_array($outcome, ['continue', 'later'], true)) {
            Http::json(['error' => '请选择继续原任务或稍后再做。'], 422);
        }
        $task = ownedRow($db, 'tasks', $taskId, $userId);
        $rescueError = finishRescueSession($db, $task, $userId, $outcome);
        if ($rescueError !== null) {
            Http::json(['error' => $rescueError['message']], $rescueError['status']);
        }
        Http::json(['task' => findTask($db, $taskId, $userId, $timezone)]);

    case 'focus.start':
    case 'focus.pause':
    case 'focus.resume':
    case 'focus.end':
        Http::requireMethod('POST');
        $input = Http::input();
        $taskId = (int) ($input['taskId'] ?? 0);
        $task = ownedRow($db, 'tasks', $taskId, $userId);
        $focusAction = substr($action, strlen('focus.'));
        if ($focusAction === 'start' && !(bool) ($task['is_focus'] ?? false)) {
            Http::json(['error' => '请先把这个任务设为专注任务。'], 422);
        }
        $idleSeconds = $focusAction === 'pause'
            ? max(0, min(660, (int) ($input['idleSeconds'] ?? 0)))
            : 0;
        $focusError = updateFocusSession($db, $task, $userId, $focusAction, $idleSeconds);
        if ($focusError !== null) {
            Http::json(['error' => $focusError['message']], $focusError['status']);
        }
        Http::json(['task' => findTask($db, $taskId, $userId, $timezone)]);

    case 'daily.morning':
        Http::requireMethod('POST');
        $input = Http::input();
        $wakeTime = validTime(nullableString($input['wakeTime'] ?? null));
        $energy = validEnergy($input['energy'] ?? null);
        $focusTaskId = nullableInt($input['focusTaskId'] ?? null);
        if ($wakeTime === null || $energy === null) {
            Http::json(['error' => '请填写起床时间和今日精力。'], 422);
        }
        if ($focusTaskId !== null) {
            $focusTask = ownedRow($db, 'tasks', $focusTaskId, $userId);
            if (in_array($focusTask['status'], ['completed', 'cancelled'], true)) {
                Http::json(['error' => '今日重点必须是尚未完成的任务。'], 422);
            }
        }
        $today = (new DateTimeImmutable('today', new DateTimeZone($timezone)))->format('Y-m-d');
        $now = gmdate('Y-m-d H:i:s');
        $statement = $db->prepare(
            'INSERT INTO daily_checkins (user_id, local_date, wake_time, had_breakfast, morning_energy, daily_focus_task_id, morning_completed_at, morning_skipped_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE wake_time = VALUES(wake_time), had_breakfast = VALUES(had_breakfast), morning_energy = VALUES(morning_energy), daily_focus_task_id = VALUES(daily_focus_task_id), morning_completed_at = VALUES(morning_completed_at), morning_skipped_at = NULL'
        );
        $statement->execute([$userId, $today, $wakeTime, (int) (bool) ($input['hadBreakfast'] ?? false), $energy, $focusTaskId, $now]);
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'daily.morning.skip':
        Http::requireMethod('POST');
        $today = (new DateTimeImmutable('today', new DateTimeZone($timezone)))->format('Y-m-d');
        $now = gmdate('Y-m-d H:i:s');
        $statement = $db->prepare(
            'INSERT INTO daily_checkins (user_id, local_date, morning_skipped_at) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE morning_skipped_at = IF(morning_completed_at IS NULL, VALUES(morning_skipped_at), morning_skipped_at)'
        );
        $statement->execute([$userId, $today, $now]);
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'daily.close':
        Http::requireMethod('POST');
        $input = Http::input();
        $energy = validEnergy($input['energy'] ?? null);
        if ($energy === null) {
            Http::json(['error' => '请选择今晚的精力状态。'], 422);
        }
        $reflection = trim((string) ($input['reflection'] ?? ''));
        $reflectionLength = function_exists('mb_strlen') ? mb_strlen($reflection) : strlen($reflection);
        if ($reflectionLength > 2000) {
            Http::json(['error' => '今日感受请控制在 2000 字以内。'], 422);
        }
        $decisions = is_array($input['decisions'] ?? null) ? $input['decisions'] : [];
        if (count($decisions) > 200) {
            Http::json(['error' => '一次处理的任务太多。'], 422);
        }
        $today = (new DateTimeImmutable('today', new DateTimeZone($timezone)))->format('Y-m-d');
        $now = gmdate('Y-m-d H:i:s');
        $db->beginTransaction();
        try {
            $checkinStatement = $db->prepare('SELECT closed_at FROM daily_checkins WHERE user_id = ? AND local_date = ? LIMIT 1 FOR UPDATE');
            $checkinStatement->execute([$userId, $today]);
            $existingCheckin = $checkinStatement->fetch();
            if ($existingCheckin && !empty($existingCheckin['closed_at'])) {
                $db->commit();
                Http::json(bootstrapData($db, $userId, $timezone));
            }
            $seen = [];
            foreach ($decisions as $decision) {
                if (!is_array($decision)) {
                    continue;
                }
                $taskId = (int) ($decision['taskId'] ?? 0);
                $choice = (string) ($decision['action'] ?? 'later');
                $failureReason = validFailureReason($decision['reason'] ?? null);
                if ($taskId < 1 || isset($seen[$taskId]) || !in_array($choice, ['tomorrow', 'later', 'drop'], true)) {
                    continue;
                }
                $seen[$taskId] = true;
                $taskStatement = $db->prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1 FOR UPDATE");
                $taskStatement->execute([$taskId, $userId]);
                $task = $taskStatement->fetch();
                if (!$task) {
                    continue;
                }
                $db->prepare('INSERT INTO daily_task_decisions (user_id, task_id, local_date, action, failure_reason, task_title) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$userId, $taskId, $today, $choice, $failureReason, (string) $task['title']]);
                applyEveningDecision($db, $task, $choice, $timezone, $now);
            }
            $statement = $db->prepare(
                'INSERT INTO daily_checkins (user_id, local_date, evening_energy, reflection, closed_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE evening_energy = VALUES(evening_energy), reflection = VALUES(reflection), closed_at = VALUES(closed_at)'
            );
            $statement->execute([$userId, $today, $energy, $reflection, $now]);
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
        Http::json(bootstrapData($db, $userId, $timezone));

    case 'habits.create':
        Http::requireMethod('POST');
        $input = Http::input();
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            Http::json(['error' => '习惯名称不能为空。'], 422);
        }
        $localToday = new DateTimeImmutable('today', new DateTimeZone($timezone));
        $statement = $db->prepare(
            'INSERT INTO habits (user_id, name, description, color, frequency_type, target_count, schedule_days, start_date, reminder_time, allow_makeup)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            $userId,
            $name,
            trim((string) ($input['description'] ?? '')),
            validColor((string) ($input['color'] ?? '#496d5b')),
            validFrequency((string) ($input['frequencyType'] ?? 'daily')),
            max(1, min(7, (int) ($input['targetCount'] ?? 1))),
            json_encode($input['scheduleDays'] ?? [1, 2, 3, 4, 5, 6, 7], JSON_THROW_ON_ERROR),
            $localToday->format('Y-m-d'),
            nullableString($input['reminderTime'] ?? null),
            array_key_exists('allowMakeup', $input) ? (int) (bool) $input['allowMakeup'] : 1,
        ]);
        Http::json(bootstrapData($db, $userId, $timezone), 201);

    case 'habits.checkin':
        Http::requireMethod('POST');
        $input = Http::input();
        $habitId = (int) ($input['id'] ?? 0);
        ownedRow($db, 'habits', $habitId, $userId);
        $date = (string) ($input['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            Http::json(['error' => '打卡日期格式不正确。'], 422);
        }
        if ((bool) ($input['checked'] ?? false)) {
            $statement = $db->prepare(
                "INSERT INTO habit_logs (habit_id, log_date, status, completed_at) VALUES (?, ?, 'completed', ?)
                 ON DUPLICATE KEY UPDATE status = 'completed', completed_at = VALUES(completed_at)"
            );
            $statement->execute([$habitId, $date, gmdate('Y-m-d H:i:s')]);
        } else {
            $db->prepare('DELETE FROM habit_logs WHERE habit_id = ? AND log_date = ?')->execute([$habitId, $date]);
        }
        Http::json(['ok' => true]);

    case 'projects.create':
        Http::requireMethod('POST');
        $input = Http::input();
        $title = trim((string) ($input['title'] ?? ''));
        if ($title === '') {
            Http::json(['error' => '项目名称不能为空。'], 422);
        }
        $statement = $db->prepare('INSERT INTO projects (user_id, title, description, area, color, due_at, current_stage) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $statement->execute([
            $userId,
            $title,
            trim((string) ($input['description'] ?? '')),
            trim((string) ($input['area'] ?? '个人')),
            validColor((string) ($input['color'] ?? '#496d5b')),
            DateTimes::toUtc(nullableString($input['dueAt'] ?? null), $timezone),
            nullableString($input['currentStage'] ?? null),
        ]);
        $projectId = (int) $db->lastInsertId();
        $stageStatement = $db->prepare('INSERT INTO project_stages (project_id, title, position) VALUES (?, ?, ?)');
        foreach ((array) ($input['stages'] ?? []) as $position => $stage) {
            $stage = trim((string) $stage);
            if ($stage !== '') {
                $stageStatement->execute([$projectId, $stage, $position]);
            }
        }
        Http::json(bootstrapData($db, $userId, $timezone), 201);

    case 'account.password':
        Http::requireMethod('PATCH', 'POST');
        $input = Http::input();
        $currentPassword = (string) ($input['currentPassword'] ?? '');
        $newPassword = (string) ($input['newPassword'] ?? '');
        if (strlen($newPassword) < 10) {
            Http::json(['error' => '新密码至少需要 10 位。'], 422);
        }
        $passwordStatement = $db->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
        $passwordStatement->execute([$userId]);
        $passwordHash = $passwordStatement->fetchColumn();
        if (!is_string($passwordHash) || !password_verify($currentPassword, $passwordHash)) {
            Http::json(['error' => '当前密码不正确。'], 422);
        }
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([
            password_hash($newPassword, PASSWORD_DEFAULT),
            $userId,
        ]);
        session_regenerate_id(true);
        Http::json(['ok' => true]);

    case 'data.export':
        Http::requireMethod('GET');
        Http::json((new BackupManager())->export($db, $userId, $timezone));

    case 'backup.create':
        Http::requireMethod('POST');
        (new BackupManager())->create($db, $userId, $timezone, 'manual');
        Http::json(bootstrapData($db, $userId, $timezone), 201);

    case 'backup.preview':
        Http::requireMethod('POST');
        $input = Http::input();
        try {
            Http::json(['preview' => (new BackupManager())->preview((array) ($input['backup'] ?? []))]);
        } catch (RuntimeException $error) {
            Http::json(['error' => $error->getMessage()], 422);
        }

    case 'backup.download':
        Http::requireMethod('POST');
        $input = Http::input();
        try {
            Http::json((new BackupManager())->stored($db, $userId, (int) ($input['id'] ?? 0)));
        } catch (RuntimeException $error) {
            Http::json(['error' => $error->getMessage()], 404);
        }

    case 'backup.restore':
    case 'backup.restore.stored':
        Http::requireMethod('POST');
        $input = Http::input();
        $passwordHash = $db->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
        $passwordHash->execute([$userId]);
        if (!password_verify((string) ($input['password'] ?? ''), (string) $passwordHash->fetchColumn())) {
            Http::json(['error' => '登录密码不正确。'], 422);
        }
        $manager = new BackupManager();
        try {
            $backup = $action === 'backup.restore.stored'
                ? $manager->stored($db, $userId, (int) ($input['id'] ?? 0))
                : (array) ($input['backup'] ?? []);
            $manager->restore($db, $userId, $timezone, $backup);
            Http::json(bootstrapData($db, $userId, (string) (($backup['data']['account']['timezone'] ?? null) ?: $timezone)));
        } catch (RuntimeException $error) {
            Http::json(['error' => $error->getMessage()], 422);
        }

    case 'data.import':
        Http::requireMethod('POST');
        $input = Http::input();
        $plan = $input['plan'] ?? null;
        if (!is_array($plan)) {
            Http::json(['error' => '请提供有效的计划 JSON。'], 422);
        }
        try {
            $imported = (new PlanImporter())->import($db, $userId, $timezone, $plan);
            Http::json([...bootstrapData($db, $userId, $timezone), 'imported' => $imported], 201);
        } catch (PlanImportException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    case 'data.import.delete':
        Http::requireMethod('DELETE', 'POST');
        $input = Http::input();
        $importId = (int) ($input['id'] ?? 0);
        if ($importId < 1) {
            Http::json(['error' => '导入记录编号不正确。'], 422);
        }
        try {
            (new PlanImporter())->remove($db, $userId, $importId);
            Http::json(bootstrapData($db, $userId, $timezone));
        } catch (PlanImportException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    case 'settings.update':
        Http::requireMethod('PATCH', 'POST');
        $input = Http::input();
        $planningStart = validTime((string) ($input['planningStartTime'] ?? '09:00'));
        $planningEnd = validTime((string) ($input['planningEndTime'] ?? '23:30'));
        $lunchStart = validTime((string) ($input['lunchStartTime'] ?? '12:30'));
        $lunchEnd = validTime((string) ($input['lunchEndTime'] ?? '13:30'));
        $dinnerStart = validTime((string) ($input['dinnerStartTime'] ?? '18:00'));
        $dinnerEnd = validTime((string) ($input['dinnerEndTime'] ?? '19:00'));
        if ($planningStart >= $planningEnd || $lunchStart >= $lunchEnd || $dinnerStart >= $dinnerEnd) {
            Http::json(['error' => '日程、午餐或晚餐的结束时间必须晚于开始时间。'], 422);
        }
        $db->beginTransaction();
        try {
            $db->prepare('UPDATE users SET display_name = ?, email = ?, timezone = ? WHERE id = ?')->execute([
                trim((string) ($input['displayName'] ?? $user['display_name'])),
                trim((string) ($input['email'] ?? $user['email'])),
                (string) ($input['timezone'] ?? $timezone),
                $userId,
            ]);
            $db->prepare(
                'INSERT INTO user_settings (user_id, email_reminders, push_task_reminders, daily_summary, push_daily_summary, daily_summary_time, overdue_reminder, push_overdue_reminder, task_reminder_minutes, week_starts_on, planning_start_time, planning_end_time, lunch_start_time, lunch_end_time, dinner_start_time, dinner_end_time, planning_buffer_minutes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE email_reminders = VALUES(email_reminders), push_task_reminders = VALUES(push_task_reminders), daily_summary = VALUES(daily_summary), push_daily_summary = VALUES(push_daily_summary), daily_summary_time = VALUES(daily_summary_time), overdue_reminder = VALUES(overdue_reminder), push_overdue_reminder = VALUES(push_overdue_reminder), task_reminder_minutes = VALUES(task_reminder_minutes), week_starts_on = VALUES(week_starts_on), planning_start_time = VALUES(planning_start_time), planning_end_time = VALUES(planning_end_time), lunch_start_time = VALUES(lunch_start_time), lunch_end_time = VALUES(lunch_end_time), dinner_start_time = VALUES(dinner_start_time), dinner_end_time = VALUES(dinner_end_time), planning_buffer_minutes = VALUES(planning_buffer_minutes)'
            )->execute([
                $userId,
                (int) (bool) ($input['emailReminders'] ?? true),
                (int) (bool) ($input['pushTaskReminders'] ?? true),
                (int) (bool) ($input['dailySummary'] ?? true),
                (int) (bool) ($input['pushDailySummary'] ?? true),
                (string) ($input['dailySummaryTime'] ?? '21:30:00'),
                (int) (bool) ($input['overdueReminder'] ?? false),
                (int) (bool) ($input['pushOverdueReminder'] ?? false),
                max(0, min(10080, (int) ($input['taskReminderMinutes'] ?? 10))),
                in_array(($input['weekStartsOn'] ?? 'monday'), ['monday', 'sunday'], true) ? $input['weekStartsOn'] : 'monday',
                $planningStart,
                $planningEnd,
                $lunchStart,
                $lunchEnd,
                $dinnerStart,
                $dinnerEnd,
                max(0, min(120, (int) ($input['planningBufferMinutes'] ?? 15))),
            ]);
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
        Http::json(['ok' => true]);

    case 'mail.test':
        Http::requireMethod('POST');
        try {
            (new Mailer())->send($user['email'], '人生看板邮件测试', '<h2>邮件提醒已经连接成功</h2><p>以后任务和每日总结会从这里发给你。</p>', '邮件提醒已经连接成功。');
        } catch (Throwable $error) {
            error_log((string) $error);
            Http::json(['error' => '邮件发送失败，请检查 SMTP 配置或服务器网络。'], 502);
        }
        Http::json(['ok' => true]);

    case 'ai.plan':
        Http::requireMethod('POST');
        try {
            Http::json(['plan' => (new AiPlanner())->generate($db, $userId, $timezone)], 201);
        } catch (AiPlannerException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    case 'ai.plan.week':
        Http::requireMethod('POST');
        try {
            [$reviewStartUtc, $reviewEndUtc, $reviewStartLocal] = DateTimes::berlinWeekBounds($timezone);
            ensureRecurringTaskContinuity($db, $userId, $timezone, $reviewStartLocal->modify('+14 days')->format('Y-m-d'));
            $reviewContext = reviewData($db, $userId, $reviewStartUtc, $reviewEndUtc, $timezone);
            Http::json(['plan' => (new AiPlanner())->generate($db, $userId, $timezone, 'next_week', $reviewContext)], 201);
        } catch (AiPlannerException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    case 'ai.plan.rebalance':
        Http::requireMethod('POST');
        $input = Http::input();
        $energy = validEnergy($input['currentEnergy'] ?? null);
        $mode = (string) ($input['mode'] ?? 'normal');
        $latestEndValue = validTime(nullableString($input['latestEnd'] ?? null));
        if ($energy === null || !in_array($mode, ['normal', 'low_energy'], true) || $latestEndValue === null) {
            Http::json(['error' => '请选择当前精力、继续方式和最晚结束时间。'], 422);
        }
        $zone = new DateTimeZone($timezone);
        $nowLocal = new DateTimeImmutable('now', $zone);
        $latestEnd = substr($latestEndValue, 0, 5);
        $latestEndAt = new DateTimeImmutable($nowLocal->format('Y-m-d') . ' ' . $latestEndValue, $zone);
        if ($latestEndAt <= $nowLocal->modify('+15 minutes')) {
            Http::json(['error' => '最晚结束时间至少需要比现在晚 15 分钟。'], 422);
        }
        $focusStatement = $db->prepare('SELECT daily_focus_task_id FROM daily_checkins WHERE user_id = ? AND local_date = ? LIMIT 1');
        $focusStatement->execute([$userId, $nowLocal->format('Y-m-d')]);
        $dailyFocusTaskId = nullableInt($focusStatement->fetchColumn());
        try {
            Http::json(['plan' => (new AiPlanner())->generate($db, $userId, $timezone, 'rebalance', [], [
                'mode' => $mode,
                'currentEnergy' => $energy,
                'latestEnd' => $latestEnd,
                'dailyFocusTaskId' => $dailyFocusTaskId,
            ])], 201);
        } catch (AiPlannerException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    case 'ai.apply':
        Http::requireMethod('POST');
        $input = Http::input();
        $planId = (int) ($input['planId'] ?? 0);
        if ($planId < 1) {
            Http::json(['error' => 'AI 建议编号不正确。'], 422);
        }
        try {
            (new AiPlanner())->apply($db, $userId, $planId, $timezone);
            Http::json(bootstrapData($db, $userId, $timezone));
        } catch (AiPlannerException $error) {
            Http::json(['error' => $error->getMessage()], $error->httpStatus());
        }

    default:
        Http::json(['error' => '接口不存在。'], 404);
}

function bootstrapData(PDO $db, int $userId, string $timezone): array
{
    ensureRecurringTaskSeries($db, $userId);
    ensureRecurringTaskContinuity($db, $userId, $timezone);
    $tasksStatement = $db->prepare(
        'SELECT tasks.*, task_series.paused_until AS recurrence_paused_until, projects.title AS project_title, categories.name AS category_name, categories.color AS category_color
         FROM tasks
         LEFT JOIN task_series ON task_series.id = tasks.recurrence_series_id
         LEFT JOIN projects ON projects.id = tasks.project_id
         LEFT JOIN categories ON categories.id = tasks.category_id
         WHERE tasks.user_id = ? AND (tasks.status != "cancelled" OR tasks.occurrence_state = "skipped")
         ORDER BY tasks.status = "completed", tasks.start_at IS NULL, tasks.start_at, tasks.created_at DESC'
    );
    $tasksStatement->execute([$userId]);
    $taskRows = $tasksStatement->fetchAll();
    $taskIds = array_map(static fn (array $row): int => (int) $row['id'], $taskRows);
    $subtasks = subtaskMap($db, $taskIds);
    $focusSessions = focusSessionMap($db, $taskIds);
    $scheduleBlocks = scheduleBlockMap($db, $taskIds);
    $tasks = array_map(
        static fn (array $row): array => Views::task(
            $row,
            $timezone,
            $subtasks[(int) $row['id']] ?? [],
            $focusSessions[(int) $row['id']] ?? null,
            $scheduleBlocks[(int) $row['id']] ?? []
        ),
        $taskRows
    );

    $categoryStatement = $db->prepare('SELECT id, name, color FROM categories WHERE user_id = ? ORDER BY id');
    $categoryStatement->execute([$userId]);
    $categories = array_map(static fn (array $row): array => ['id' => (int) $row['id'], 'name' => $row['name'], 'color' => $row['color']], $categoryStatement->fetchAll());

    $projectStatement = $db->prepare(
        'SELECT projects.*, SUM(tasks.status != "cancelled") AS total_tasks, SUM(tasks.status = "completed") AS completed_tasks
         FROM projects LEFT JOIN tasks ON tasks.project_id = projects.id
         WHERE projects.user_id = ? AND projects.status != "archived"
         GROUP BY projects.id ORDER BY projects.updated_at DESC'
    );
    $projectStatement->execute([$userId]);
    $projects = [];
    $stageStatement = $db->prepare('SELECT title FROM project_stages WHERE project_id = ? ORDER BY position, id');
    foreach ($projectStatement->fetchAll() as $project) {
        $stageStatement->execute([(int) $project['id']]);
        $projects[] = Views::project($project, $stageStatement->fetchAll(PDO::FETCH_COLUMN));
    }

    [$weekStartUtc, $weekEndUtc, $localWeekStart] = DateTimes::berlinWeekBounds($timezone);
    $weekStartDate = $localWeekStart->format('Y-m-d');
    $weekEndDate = $localWeekStart->modify('+7 days')->format('Y-m-d');
    $habitStatement = $db->prepare('SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY created_at');
    $habitStatement->execute([$userId]);
    $logStatement = $db->prepare('SELECT log_date, status FROM habit_logs WHERE habit_id = ? AND log_date >= ? AND log_date < ?');
    $streakStatement = $db->prepare("SELECT log_date FROM habit_logs WHERE habit_id = ? AND status = 'completed' ORDER BY log_date DESC LIMIT 180");
    $habits = [];
    foreach ($habitStatement->fetchAll() as $habit) {
        $logStatement->execute([(int) $habit['id'], $weekStartDate, $weekEndDate]);
        $logs = [];
        foreach ($logStatement->fetchAll() as $log) {
            $logs[$log['log_date']] = $log['status'];
        }
        $checked = [];
        for ($index = 0; $index < 7; $index++) {
            $date = $localWeekStart->modify("+{$index} days")->format('Y-m-d');
            $checked[] = ($logs[$date] ?? null) === 'completed';
        }
        $streakStatement->execute([(int) $habit['id']]);
        $habits[] = [
            'id' => (int) $habit['id'],
            'name' => $habit['name'],
            'detail' => habitDetail($habit),
            'description' => $habit['description'] ?? '',
            'color' => $habit['color'],
            'frequencyType' => $habit['frequency_type'],
            'targetCount' => (int) $habit['target_count'],
            'scheduleDays' => json_decode($habit['schedule_days'] ?: '[]', true),
            'allowMakeup' => (bool) $habit['allow_makeup'],
            'streak' => calculateStreak($streakStatement->fetchAll(PDO::FETCH_COLUMN), $timezone),
            'checked' => $checked,
        ];
    }

    $settingsStatement = $db->prepare(
        'SELECT users.display_name, users.email, users.timezone, user_settings.*
         FROM users LEFT JOIN user_settings ON user_settings.user_id = users.id WHERE users.id = ?'
    );
    $settingsStatement->execute([$userId]);
    $settingsRow = $settingsStatement->fetch() ?: [];

    return [
        'tasks' => $tasks,
        'habits' => $habits,
        'projects' => $projects,
        'categories' => $categories,
        'planImports' => planImports($db, $userId),
        'backups' => (new BackupManager())->records($db, $userId),
        'dailyRhythm' => dailyRhythmData($db, $userId, $timezone),
        'settings' => settingsView($settingsRow),
        'review' => reviewData($db, $userId, $weekStartUtc, $weekEndUtc, $timezone),
        'csrfToken' => Auth::csrfToken(),
    ];
}

function dailyRhythmData(PDO $db, int $userId, string $timezone): array
{
    $today = new DateTimeImmutable('today', new DateTimeZone($timezone));
    $date = $today->format('Y-m-d');
    $statement = $db->prepare(
        'SELECT daily_checkins.*, tasks.title AS focus_task_title
         FROM daily_checkins LEFT JOIN tasks ON tasks.id = daily_checkins.daily_focus_task_id
         WHERE daily_checkins.user_id = ? AND daily_checkins.local_date = ? LIMIT 1'
    );
    $statement->execute([$userId, $date]);
    $row = $statement->fetch() ?: [];
    $morningCompleted = !empty($row['morning_completed_at']);
    $morningSkipped = !$morningCompleted && !empty($row['morning_skipped_at']);

    return [
        'date' => $date,
        'morningStatus' => $morningCompleted ? 'completed' : ($morningSkipped ? 'skipped' : 'pending'),
        'wakeTime' => isset($row['wake_time']) ? substr((string) $row['wake_time'], 0, 5) : null,
        'hadBreakfast' => isset($row['had_breakfast']) ? (bool) $row['had_breakfast'] : null,
        'morningEnergy' => isset($row['morning_energy']) ? (int) $row['morning_energy'] : null,
        'focusTaskId' => isset($row['daily_focus_task_id']) ? (int) $row['daily_focus_task_id'] : null,
        'focusTaskTitle' => $row['focus_task_title'] ?? null,
        'morningCompletedAt' => localTimestampView($row['morning_completed_at'] ?? null, $timezone),
        'eveningEnergy' => isset($row['evening_energy']) ? (int) $row['evening_energy'] : null,
        'reflection' => $row['reflection'] ?? '',
        'closedAt' => localTimestampView($row['closed_at'] ?? null, $timezone),
        'morningStreak' => dailyCheckinStreak($db, $userId, 'morning_completed_at', $timezone),
        'eveningStreak' => dailyCheckinStreak($db, $userId, 'closed_at', $timezone),
    ];
}

function dailyCheckinStreak(PDO $db, int $userId, string $column, string $timezone): int
{
    if (!in_array($column, ['morning_completed_at', 'closed_at'], true)) {
        return 0;
    }
    $today = (new DateTimeImmutable('today', new DateTimeZone($timezone)))->format('Y-m-d');
    $statement = $db->prepare("SELECT local_date FROM daily_checkins WHERE user_id = ? AND {$column} IS NOT NULL AND local_date <= ? ORDER BY local_date DESC LIMIT 400");
    $statement->execute([$userId, $today]);
    return calculateStreak($statement->fetchAll(PDO::FETCH_COLUMN), $timezone);
}

function localTimestampView(mixed $value, string $timezone): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return (new DateTimeImmutable((string) $value, new DateTimeZone('UTC')))
        ->setTimezone(new DateTimeZone($timezone))
        ->format(DATE_ATOM);
}

function applyEveningDecision(PDO $db, array $task, string $choice, string $timezone, string $now): void
{
    endFocusSessionForEvening($db, (int) $task['id'], $now);

    if ($choice === 'drop') {
        if (nullableString($task['recurrence_rule'] ?? null) !== null) {
            createNextRecurringTask($db, $task, $timezone);
        }
        $db->prepare("UPDATE tasks SET status = 'cancelled', occurrence_state = 'skipped', reminder_at = NULL, reminder_sent_at = NULL, push_reminder_sent_at = NULL WHERE id = ? AND user_id = ?")
            ->execute([(int) $task['id'], (int) $task['user_id']]);
        return;
    }

    if (nullableString($task['recurrence_rule'] ?? null) !== null) {
        createNextRecurringTask($db, $task, $timezone);
        $db->prepare('UPDATE tasks SET recurrence_rule = NULL, recurrence_series_id = NULL WHERE id = ? AND user_id = ?')
            ->execute([(int) $task['id'], (int) $task['user_id']]);
    }
    $db->prepare('DELETE FROM task_schedule_blocks WHERE task_id = ? AND user_id = ?')
        ->execute([(int) $task['id'], (int) $task['user_id']]);

    if ($choice === 'later') {
        $db->prepare("UPDATE tasks SET status = 'inbox', start_at = NULL, end_at = NULL, schedule_mode = 'flexible', reminder_at = NULL, reminder_sent_at = NULL, push_reminder_sent_at = NULL WHERE id = ? AND user_id = ?")
            ->execute([(int) $task['id'], (int) $task['user_id']]);
        return;
    }

    $zone = new DateTimeZone($timezone);
    $tomorrow = new DateTimeImmutable('tomorrow', $zone);
    $originalStart = empty($task['start_at'])
        ? null
        : (new DateTimeImmutable((string) $task['start_at'], new DateTimeZone('UTC')))->setTimezone($zone);
    $hour = $originalStart?->format('H') ?? '09';
    $minute = $originalStart?->format('i') ?? '00';
    $startLocal = $tomorrow->setTime((int) $hour, (int) $minute);
    $endLocal = $startLocal->modify('+' . max(1, (int) $task['estimated_minutes']) . ' minutes');
    $startUtc = $startLocal->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $endUtc = $endLocal->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $dueAt = $task['due_at'] ?? null;
    if ($dueAt !== null) {
        $dueLocal = (new DateTimeImmutable((string) $dueAt, new DateTimeZone('UTC')))->setTimezone($zone);
        if ($dueLocal->format('Y-m-d') <= $tomorrow->modify('-1 day')->format('Y-m-d')) {
            $dueAt = $endUtc;
        }
    }
    $reminderMinutes = isset($task['reminder_minutes']) ? (int) $task['reminder_minutes'] : null;
    $db->prepare(
        "UPDATE tasks SET status = 'planned', start_at = ?, end_at = ?, due_at = ?, occurrence_state = 'normal', reminder_at = ?, reminder_sent_at = NULL, push_reminder_sent_at = NULL WHERE id = ? AND user_id = ?"
    )->execute([$startUtc, $endUtc, $dueAt, reminderAt($startUtc, $reminderMinutes), (int) $task['id'], (int) $task['user_id']]);
}

function endFocusSessionForEvening(PDO $db, int $taskId, string $now): void
{
    $session = latestFocusSession($db, $taskId, true);
    if ($session === null || !in_array($session['status'], ['running', 'paused'], true)) {
        return;
    }
    $elapsed = $session['status'] === 'running' ? runningFocusElapsed($session) : (int) $session['elapsed_seconds'];
    $db->prepare("UPDATE focus_sessions SET status = 'completed', elapsed_seconds = ?, last_resumed_at = NULL, ended_at = ? WHERE id = ?")
        ->execute([$elapsed, $now, (int) $session['id']]);
}

function ensureRecurringTaskSeries(PDO $db, int $userId): void
{
    $statement = $db->prepare(
        'SELECT id, recurrence_source_task_id, recurrence_series_id, recurrence_rule
         FROM tasks WHERE user_id = ? AND recurrence_rule IS NOT NULL AND recurrence_rule != ""
         ORDER BY id'
    );
    $statement->execute([$userId]);
    $seriesByTask = [];
    $update = $db->prepare('UPDATE tasks SET recurrence_series_id = ? WHERE id = ? AND user_id = ?');
    foreach ($statement->fetchAll() as $task) {
        $taskId = (int) $task['id'];
        $seriesId = nullableInt($task['recurrence_series_id'] ?? null);
        $parentId = nullableInt($task['recurrence_source_task_id'] ?? null);
        if ($seriesId === null && $parentId !== null) {
            $seriesId = $seriesByTask[$parentId] ?? null;
        }
        if ($seriesId === null) {
            $seriesId = createTaskSeries($db, $userId, (string) $task['recurrence_rule']);
        }
        $seriesByTask[$taskId] = $seriesId;
        if (nullableInt($task['recurrence_series_id'] ?? null) !== $seriesId) {
            $update->execute([$seriesId, $taskId, $userId]);
        }
    }
}

function createTaskSeries(PDO $db, int $userId, string $recurrenceRule): int
{
    $statement = $db->prepare('INSERT INTO task_series (user_id, recurrence_rule) VALUES (?, ?)');
    $statement->execute([$userId, $recurrenceRule]);
    return (int) $db->lastInsertId();
}

function ensureRecurringTaskContinuity(PDO $db, int $userId, string $timezone, ?string $throughDate = null): void
{
    $cutoffLocal = $throughDate === null
        ? new DateTimeImmutable('tomorrow', new DateTimeZone($timezone))
        : new DateTimeImmutable($throughDate, new DateTimeZone($timezone));
    $cutoff = $cutoffLocal
        ->setTimezone(new DateTimeZone('UTC'))
        ->format('Y-m-d H:i:s');
    $leafStatement = $db->prepare(
        'SELECT task.* FROM tasks AS task
         LEFT JOIN tasks AS child ON child.recurrence_source_task_id = task.id
         WHERE task.user_id = ?
           AND task.recurrence_rule IS NOT NULL
           AND task.recurrence_rule != ""
           AND child.id IS NULL
           AND COALESCE(task.start_at, task.due_at, task.end_at) < ?
         ORDER BY COALESCE(task.start_at, task.due_at, task.end_at)
         LIMIT 200'
    );

    for ($round = 0; $round < 370; $round++) {
        $leafStatement->execute([$userId, $cutoff]);
        $leaves = $leafStatement->fetchAll();
        if ($leaves === []) {
            return;
        }
        foreach ($leaves as $leaf) {
            createNextRecurringTask($db, $leaf, $timezone);
        }
    }

    throw new RuntimeException('Recurring task continuity limit exceeded.');
}

function planImports(PDO $db, int $userId): array
{
    $statement = $db->prepare('SELECT id, import_key, document_name, imported_counts, created_at FROM plan_imports WHERE user_id = ? ORDER BY created_at DESC, id DESC');
    $statement->execute([$userId]);
    return array_map(static function (array $row): array {
        $counts = json_decode((string) $row['imported_counts'], true);
        return [
            'id' => (int) $row['id'],
            'importKey' => $row['import_key'],
            'name' => $row['document_name'],
            'counts' => is_array($counts) ? $counts : [],
            'createdAt' => (new DateTimeImmutable((string) $row['created_at'], new DateTimeZone('UTC')))->format(DATE_ATOM),
        ];
    }, $statement->fetchAll());
}

function findTask(PDO $db, int $taskId, int $userId, string $timezone): array
{
    $statement = $db->prepare(
        'SELECT tasks.*, task_series.paused_until AS recurrence_paused_until, projects.title AS project_title, categories.name AS category_name, categories.color AS category_color
         FROM tasks LEFT JOIN task_series ON task_series.id = tasks.recurrence_series_id LEFT JOIN projects ON projects.id = tasks.project_id LEFT JOIN categories ON categories.id = tasks.category_id
         WHERE tasks.id = ? AND tasks.user_id = ? LIMIT 1'
    );
    $statement->execute([$taskId, $userId]);
    $task = $statement->fetch();
    if (!$task) {
        Http::json(['error' => '任务不存在。'], 404);
    }

    $blocks = scheduleBlockMap($db, [$taskId]);
    return Views::task($task, $timezone, taskSubtasks($db, $taskId), latestFocusSession($db, $taskId), $blocks[$taskId] ?? []);
}

function latestFocusSession(PDO $db, int $taskId, bool $forUpdate = false): ?array
{
    $sql = 'SELECT * FROM focus_sessions WHERE task_id = ? ORDER BY id DESC LIMIT 1';
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }
    $statement = $db->prepare($sql);
    $statement->execute([$taskId]);
    $session = $statement->fetch();
    return $session ?: null;
}

function focusSessionMap(PDO $db, array $taskIds): array
{
    if ($taskIds === []) {
        return [];
    }
    $placeholders = implode(', ', array_fill(0, count($taskIds), '?'));
    $statement = $db->prepare("SELECT * FROM focus_sessions WHERE task_id IN ({$placeholders}) ORDER BY task_id, id DESC");
    $statement->execute($taskIds);
    $map = [];
    foreach ($statement->fetchAll() as $session) {
        $taskId = (int) $session['task_id'];
        if (!isset($map[$taskId])) {
            $map[$taskId] = $session;
        }
    }
    return $map;
}

function startRescueSession(PDO $db, array $task, int $userId, string $reason, string $step, int $durationMinutes): ?array
{
    $db->beginTransaction();
    try {
        $taskId = (int) $task['id'];
        $session = latestFocusSession($db, $taskId, true);
        if ($session !== null && in_array($session['status'], ['running', 'paused'], true)) {
            $db->commit();
            return ['message' => '这个任务已有计时，请先暂停或结束它。', 'status' => 409];
        }
        $other = $db->prepare("SELECT task_id FROM focus_sessions WHERE user_id = ? AND status = 'running' LIMIT 1 FOR UPDATE");
        $other->execute([$userId]);
        if ($other->fetchColumn() !== false) {
            $db->commit();
            return ['message' => '另一个任务正在计时，请先暂停或结束它。', 'status' => 409];
        }
        $now = gmdate('Y-m-d H:i:s');
        $statement = $db->prepare(
            "INSERT INTO focus_sessions
                (user_id, task_id, session_type, status, planned_seconds, rescue_reason, rescue_step, elapsed_seconds, started_at, last_resumed_at)
             VALUES (?, ?, 'rescue', 'running', ?, ?, ?, 0, ?, ?)"
        );
        $statement->execute([$userId, $taskId, $durationMinutes * 60, $reason, $step, $now, $now]);
        $db->prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND user_id = ?")
            ->execute([$taskId, $userId]);
        $db->commit();
        return null;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function finishRescueSession(PDO $db, array $task, int $userId, string $outcome): ?array
{
    $db->beginTransaction();
    try {
        $taskId = (int) $task['id'];
        $session = latestFocusSession($db, $taskId, true);
        if ($session === null || ($session['session_type'] ?? 'focus') !== 'rescue' || !in_array($session['status'], ['running', 'paused'], true)) {
            $db->commit();
            return ['message' => '这个任务没有正在进行的启动救援。', 'status' => 409];
        }
        $now = gmdate('Y-m-d H:i:s');
        $elapsed = $session['status'] === 'running' ? runningFocusElapsed($session) : (int) $session['elapsed_seconds'];
        $db->prepare(
            "UPDATE focus_sessions SET status = 'completed', rescue_outcome = ?, elapsed_seconds = ?,
             last_resumed_at = NULL, ended_at = ? WHERE id = ?"
        )->execute([$outcome, max(0, $elapsed), $now, (int) $session['id']]);

        if ($outcome === 'continue') {
            $db->prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND user_id = ?")
                ->execute([$taskId, $userId]);
            if ((bool) ($task['is_focus'] ?? false)) {
                $other = $db->prepare("SELECT task_id FROM focus_sessions WHERE user_id = ? AND task_id != ? AND status = 'running' LIMIT 1 FOR UPDATE");
                $other->execute([$userId, $taskId]);
                if ($other->fetchColumn() === false) {
                    $db->prepare(
                        "INSERT INTO focus_sessions (user_id, task_id, session_type, status, planned_seconds, elapsed_seconds, started_at, last_resumed_at)
                         VALUES (?, ?, 'focus', 'running', ?, 0, ?, ?)"
                    )->execute([$userId, $taskId, max(60, (int) $task['estimated_minutes'] * 60), $now, $now]);
                }
            }
        } else {
            $start = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 minutes');
            $end = $start->modify('+' . max(1, (int) $task['estimated_minutes']) . ' minutes');
            $reminderMinutes = $task['reminder_minutes'] === null ? null : max(0, (int) $task['reminder_minutes']);
            $reminderAt = $reminderMinutes === null ? null : $start->modify("-{$reminderMinutes} minutes")->format('Y-m-d H:i:s');
            $db->prepare('DELETE FROM task_schedule_blocks WHERE user_id = ? AND task_id = ?')->execute([$userId, $taskId]);
            $db->prepare(
                "UPDATE tasks SET status = 'planned', start_at = ?, end_at = ?, reminder_at = ?, reminder_sent_at = NULL, push_reminder_sent_at = NULL
                 WHERE id = ? AND user_id = ?"
            )->execute([$start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s'), $reminderAt, $taskId, $userId]);
        }
        $db->commit();
        return null;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function updateFocusSession(PDO $db, array $task, int $userId, string $action, int $idleSeconds = 0): ?array
{
    $db->beginTransaction();
    try {
        $session = latestFocusSession($db, (int) $task['id'], true);
        $now = gmdate('Y-m-d H:i:s');

        if ($action === 'start') {
            if ($session === null || $session['status'] === 'completed') {
                $other = $db->prepare("SELECT task_id FROM focus_sessions WHERE user_id = ? AND task_id != ? AND status = 'running' LIMIT 1 FOR UPDATE");
                $other->execute([$userId, (int) $task['id']]);
                if ($other->fetchColumn() !== false) {
                    $db->commit();
                    return ['message' => '另一个任务正在专注，请先暂停或结束它。', 'status' => 409];
                }
                $statement = $db->prepare(
                    "INSERT INTO focus_sessions (user_id, task_id, status, planned_seconds, elapsed_seconds, started_at, last_resumed_at)
                     VALUES (?, ?, 'running', ?, 0, ?, ?)"
                );
                $statement->execute([
                    $userId,
                    (int) $task['id'],
                    max(60, (int) $task['estimated_minutes'] * 60),
                    $now,
                    $now,
                ]);
            }
            $db->commit();
            return null;
        }

        if ($session === null || $session['status'] === 'completed') {
            $db->commit();
            return ['message' => '这个任务还没有正在进行的专注计时。', 'status' => 409];
        }

        if ($action === 'pause') {
            if ($session['status'] !== 'running') {
                $db->commit();
                return ['message' => '专注计时已经暂停。', 'status' => 409];
            }
            $elapsed = max(0, runningFocusElapsed($session) - $idleSeconds);
            $db->prepare("UPDATE focus_sessions SET status = 'paused', elapsed_seconds = ?, last_resumed_at = NULL WHERE id = ?")
                ->execute([$elapsed, (int) $session['id']]);
        } elseif ($action === 'resume') {
            if ($session['status'] !== 'paused') {
                $db->commit();
                return ['message' => '只有暂停中的专注计时可以继续。', 'status' => 409];
            }
            $other = $db->prepare("SELECT task_id FROM focus_sessions WHERE user_id = ? AND task_id != ? AND status = 'running' LIMIT 1 FOR UPDATE");
            $other->execute([$userId, (int) $task['id']]);
            if ($other->fetchColumn() !== false) {
                $db->commit();
                return ['message' => '另一个任务正在专注，请先暂停或结束它。', 'status' => 409];
            }
            $db->prepare("UPDATE focus_sessions SET status = 'running', last_resumed_at = ? WHERE id = ?")
                ->execute([$now, (int) $session['id']]);
        } elseif ($action === 'end') {
            $elapsed = $session['status'] === 'running' ? runningFocusElapsed($session) : (int) $session['elapsed_seconds'];
            $db->prepare("UPDATE focus_sessions SET status = 'completed', elapsed_seconds = ?, last_resumed_at = NULL, ended_at = ? WHERE id = ?")
                ->execute([$elapsed, $now, (int) $session['id']]);
        } else {
            $db->commit();
            return ['message' => '无法识别专注计时操作。', 'status' => 422];
        }
        $db->commit();
        return null;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function runningFocusElapsed(array $session): int
{
    $elapsed = (int) $session['elapsed_seconds'];
    if (($session['status'] ?? '') !== 'running' || empty($session['last_resumed_at'])) {
        return $elapsed;
    }
    $resumedAt = strtotime((string) $session['last_resumed_at'] . ' UTC');
    return $elapsed + max(0, time() - ($resumedAt === false ? time() : $resumedAt));
}

function recordedFocusMinutes(PDO $db, int $taskId): int
{
    $statement = $db->prepare('SELECT elapsed_seconds FROM focus_sessions WHERE task_id = ?');
    $statement->execute([$taskId]);
    $seconds = array_reduce(
        $statement->fetchAll(PDO::FETCH_COLUMN),
        static fn (int $total, mixed $elapsed): int => $total + max(0, (int) $elapsed),
        0,
    );
    return $seconds > 0 ? max(1, (int) round($seconds / 60)) : 0;
}

function taskSubtasks(PDO $db, int $taskId): array
{
    $statement = $db->prepare('SELECT id, title, completed, position FROM subtasks WHERE task_id = ? ORDER BY position, id');
    $statement->execute([$taskId]);
    return $statement->fetchAll();
}

function subtaskMap(PDO $db, array $taskIds): array
{
    if ($taskIds === []) {
        return [];
    }

    $placeholders = implode(', ', array_fill(0, count($taskIds), '?'));
    $statement = $db->prepare("SELECT id, task_id, title, completed, position FROM subtasks WHERE task_id IN ({$placeholders}) ORDER BY task_id, position, id");
    $statement->execute($taskIds);
    $map = [];
    foreach ($statement->fetchAll() as $subtask) {
        $map[(int) $subtask['task_id']][] = $subtask;
    }
    return $map;
}

function scheduleBlockMap(PDO $db, array $taskIds): array
{
    if ($taskIds === []) {
        return [];
    }
    $placeholders = implode(', ', array_fill(0, count($taskIds), '?'));
    $statement = $db->prepare(
        "SELECT id, task_id, start_at, end_at, source, position
         FROM task_schedule_blocks WHERE task_id IN ({$placeholders}) ORDER BY task_id, position, start_at"
    );
    $statement->execute($taskIds);
    $map = [];
    foreach ($statement->fetchAll() as $block) {
        $map[(int) $block['task_id']][] = $block;
    }
    return $map;
}

function normalizedSubtasks(mixed $value): array
{
    $normalized = [];
    foreach ((array) $value as $subtask) {
        if (is_array($subtask)) {
            $title = trim((string) ($subtask['title'] ?? ''));
            $id = nullableInt($subtask['id'] ?? null);
            $completed = (bool) ($subtask['completed'] ?? false);
        } else {
            $title = trim((string) $subtask);
            $id = null;
            $completed = false;
        }
        if ($title !== '') {
            $normalized[] = ['id' => $id, 'title' => $title, 'completed' => $completed];
        }
    }
    return $normalized;
}

function syncTaskSubtasks(PDO $db, int $taskId, array $input): void
{
    $subtasks = normalizedSubtasks($input);
    $existingIds = array_map(static fn (array $subtask): int => (int) $subtask['id'], taskSubtasks($db, $taskId));
    $keptIds = [];
    $update = $db->prepare('UPDATE subtasks SET title = ?, completed = ?, position = ? WHERE id = ? AND task_id = ?');
    $insert = $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) VALUES (?, ?, ?, ?)');
    foreach ($subtasks as $position => $subtask) {
        if ($subtask['id'] !== null && in_array((int) $subtask['id'], $existingIds, true)) {
            $update->execute([$subtask['title'], (int) $subtask['completed'], $position, $subtask['id'], $taskId]);
            $keptIds[] = (int) $subtask['id'];
            continue;
        }
        $insert->execute([$taskId, $subtask['title'], (int) $subtask['completed'], $position]);
        $keptIds[] = (int) $db->lastInsertId();
    }

    if ($keptIds === []) {
        $db->prepare('DELETE FROM subtasks WHERE task_id = ?')->execute([$taskId]);
        return;
    }
    $placeholders = implode(', ', array_fill(0, count($keptIds), '?'));
    $db->prepare("DELETE FROM subtasks WHERE task_id = ? AND id NOT IN ({$placeholders})")->execute([$taskId, ...$keptIds]);
}

function createNextRecurringTask(PDO $db, array $task, string $timezone): ?int
{
    $rule = strtoupper((string) ($task['recurrence_rule'] ?? ''));
    $interval = match (true) {
        str_starts_with($rule, 'FREQ=DAILY') => new DateInterval('P1D'),
        str_starts_with($rule, 'FREQ=WEEKLY') => new DateInterval('P1W'),
        str_starts_with($rule, 'FREQ=MONTHLY') => new DateInterval('P1M'),
        default => null,
    };
    if ($interval === null) {
        return null;
    }

    $existing = $db->prepare('SELECT id FROM tasks WHERE recurrence_source_task_id = ? LIMIT 1');
    $existing->execute([(int) $task['id']]);
    $existingId = $existing->fetchColumn();
    if ($existingId !== false) {
        return (int) $existingId;
    }

    $nextStart = shiftedRecurringTimestamp($task['start_at'] ?? null, $interval);
    $nextEnd = shiftedRecurringTimestamp($task['end_at'] ?? null, $interval);
    $nextDue = shiftedRecurringTimestamp($task['due_at'] ?? null, $interval);
    if ($nextStart === null && $nextEnd === null && $nextDue === null) {
        return null;
    }
    $reminderMinutes = isset($task['reminder_minutes']) ? (int) $task['reminder_minutes'] : null;
    $seriesId = nullableInt($task['recurrence_series_id'] ?? null);
    $pausedUntil = null;
    if ($seriesId !== null) {
        $series = $db->prepare('SELECT paused_until FROM task_series WHERE id = ? AND user_id = ? LIMIT 1');
        $series->execute([$seriesId, (int) $task['user_id']]);
        $pausedUntil = nullableString($series->fetchColumn());
    }
    $nextMoment = $nextStart ?? $nextDue ?? $nextEnd;
    $nextLocalDate = $nextMoment === null ? null : (new DateTimeImmutable($nextMoment, new DateTimeZone('UTC')))
        ->setTimezone(new DateTimeZone($timezone))
        ->format('Y-m-d');
    $skipped = $pausedUntil !== null && $nextLocalDate !== null && $nextLocalDate < $pausedUntil;

    $statement = $db->prepare(
        'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, is_focus, recurrence_rule, recurrence_source_task_id, recurrence_series_id, occurrence_state, schedule_mode, window_start, window_end, reminder_minutes, reminder_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        (int) $task['user_id'],
        nullableInt($task['project_id'] ?? null),
        nullableInt($task['category_id'] ?? null),
        $task['title'],
        $task['notes'] ?? '',
        $skipped ? 'cancelled' : ($nextStart === null ? 'inbox' : 'planned'),
        $task['priority'],
        $nextStart,
        $nextEnd,
        $nextDue,
        (int) $task['estimated_minutes'],
        (int) ($task['is_focus'] ?? 0),
        $task['recurrence_rule'],
        (int) $task['id'],
        $seriesId,
        $skipped ? 'skipped' : 'normal',
        $task['schedule_mode'] ?? ($nextStart === null ? 'flexible' : 'fixed'),
        $task['window_start'] ?? null,
        $task['window_end'] ?? null,
        $reminderMinutes,
        $skipped ? null : reminderAt($nextStart, $reminderMinutes),
    ]);
    $nextTaskId = (int) $db->lastInsertId();
    $copy = $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) SELECT ?, title, 0, position FROM subtasks WHERE task_id = ?');
    $copy->execute([$nextTaskId, (int) $task['id']]);
    $track = $db->prepare(
        'INSERT IGNORE INTO plan_import_items (plan_import_id, entity_type, entity_id)
         SELECT plan_import_id, "task", ? FROM plan_import_items WHERE entity_type = "task" AND entity_id = ?'
    );
    $track->execute([$nextTaskId, (int) $task['id']]);
    return $nextTaskId;
}

function shiftedRecurringTimestamp(mixed $value, DateInterval $interval): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return (new DateTimeImmutable((string) $value, new DateTimeZone('UTC')))->add($interval)->format('Y-m-d H:i:s');
}

function ownedRow(PDO $db, string $table, int $id, int $userId): array
{
    if (!in_array($table, ['tasks', 'habits', 'projects'], true)) {
        throw new InvalidArgumentException('Invalid table.');
    }
    $statement = $db->prepare("SELECT * FROM {$table} WHERE id = ? AND user_id = ? LIMIT 1");
    $statement->execute([$id, $userId]);
    $row = $statement->fetch();
    if (!$row) {
        Http::json(['error' => '记录不存在。'], 404);
    }

    return $row;
}

function reminderAt(?string $startAt, ?int $minutes): ?string
{
    if ($startAt === null || $minutes === null) {
        return null;
    }

    return (new DateTimeImmutable($startAt, new DateTimeZone('UTC')))
        ->sub(new DateInterval('PT' . max(0, $minutes) . 'M'))
        ->format('Y-m-d H:i:s');
}

function calculateStreak(array $dates, string $timezone): int
{
    $dateSet = array_fill_keys($dates, true);
    $cursor = new DateTimeImmutable('today', new DateTimeZone($timezone));
    if (!isset($dateSet[$cursor->format('Y-m-d')])) {
        $cursor = $cursor->modify('-1 day');
    }
    $streak = 0;
    while (isset($dateSet[$cursor->format('Y-m-d')])) {
        $streak++;
        $cursor = $cursor->modify('-1 day');
    }
    return $streak;
}

function habitDetail(array $habit): string
{
    return match ($habit['frequency_type']) {
        'daily' => '每天',
        'weekly' => '每周 ' . (int) $habit['target_count'] . ' 次',
        default => '自定义频率',
    };
}

function reviewData(PDO $db, int $userId, string $weekStart, string $weekEnd, string $timezone): array
{
    $zone = new DateTimeZone($timezone);
    $startLocal = (new DateTimeImmutable($weekStart, new DateTimeZone('UTC')))->setTimezone($zone);
    $endLocal = (new DateTimeImmutable($weekEnd, new DateTimeZone('UTC')))->setTimezone($zone);
    $days = [];
    for ($index = 0; $index < 7; $index++) {
        $date = $startLocal->modify("+{$index} days")->format('Y-m-d');
        $days[$date] = [
            'date' => $date,
            'total' => 0,
            'completed' => 0,
            'completionRate' => 0,
            'plannedMinutes' => 0,
            'focusMinutes' => 0,
            'wakeTime' => null,
            'hadBreakfast' => null,
            'morningEnergy' => null,
            'eveningEnergy' => null,
            'focusSelected' => false,
            'focusCompleted' => false,
            'closed' => false,
        ];
    }

    $taskStatement = $db->prepare(
        "SELECT id, status, start_at, due_at, completed_at, estimated_minutes, actual_minutes, is_focus
         FROM tasks WHERE user_id = ? AND status != 'cancelled'"
    );
    $taskStatement->execute([$userId]);
    $total = 0;
    $completed = 0;
    $plannedMinutes = 0;
    $completedMinutes = 0;
    $focusPlannedMinutes = 0;
    $calibrationSamples = 0;
    $calibrationEstimatedMinutes = 0;
    $calibrationActualMinutes = 0;
    $calibrationAbsoluteError = 0;
    foreach ($taskStatement->fetchAll() as $task) {
        $date = reviewLocalDate($task['start_at'] ?? null, $zone)
            ?? reviewLocalDate($task['due_at'] ?? null, $zone)
            ?? reviewLocalDate($task['completed_at'] ?? null, $zone);
        if ($date === null || !isset($days[$date])) {
            continue;
        }
        $duration = max(0, (int) $task['estimated_minutes']);
        $isCompleted = $task['status'] === 'completed';
        $total++;
        $plannedMinutes += $duration;
        $days[$date]['total']++;
        $days[$date]['plannedMinutes'] += $duration;
        if ((bool) $task['is_focus']) {
            $focusPlannedMinutes += $duration;
        }
        if ($isCompleted) {
            $completed++;
            $completedMinutes += $duration;
            $days[$date]['completed']++;
            if ($task['actual_minutes'] !== null) {
                $actualMinutes = max(1, (int) $task['actual_minutes']);
                $calibrationSamples++;
                $calibrationEstimatedMinutes += $duration;
                $calibrationActualMinutes += $actualMinutes;
                $calibrationAbsoluteError += abs($actualMinutes - $duration);
            }
        }
    }

    $focusStatement = $db->prepare(
        'SELECT session_type, status, elapsed_seconds, last_resumed_at, started_at, rescue_reason, rescue_outcome
         FROM focus_sessions WHERE user_id = ? AND started_at >= ? AND started_at < ?'
    );
    $focusStatement->execute([$userId, $weekStart, $weekEnd]);
    $focusActualSeconds = 0;
    $rescueStarts = 0;
    $rescueContinued = 0;
    $rescueSeconds = 0;
    $rescueReasonCounts = [];
    foreach ($focusStatement->fetchAll() as $session) {
        $seconds = ($session['status'] ?? '') === 'running'
            ? runningFocusElapsed($session)
            : max(0, (int) $session['elapsed_seconds']);
        if (($session['session_type'] ?? 'focus') === 'rescue') {
            $rescueStarts++;
            $rescueSeconds += $seconds;
            $rescueContinued += (int) (($session['rescue_outcome'] ?? null) === 'continue');
            $reason = (string) ($session['rescue_reason'] ?? '');
            if ($reason !== '') {
                $rescueReasonCounts[$reason] = ($rescueReasonCounts[$reason] ?? 0) + 1;
            }
            continue;
        }
        $focusActualSeconds += $seconds;
        $date = reviewLocalDate($session['started_at'] ?? null, $zone);
        if ($date !== null && isset($days[$date])) {
            $days[$date]['focusMinutes'] += (int) round($seconds / 60);
        }
    }

    $checkinStatement = $db->prepare(
        'SELECT daily_checkins.*, tasks.status AS focus_task_status
         FROM daily_checkins
         LEFT JOIN tasks ON tasks.id = daily_checkins.daily_focus_task_id
         WHERE daily_checkins.user_id = ? AND daily_checkins.local_date >= ? AND daily_checkins.local_date < ?
         ORDER BY daily_checkins.local_date'
    );
    $checkinStatement->execute([$userId, $startLocal->format('Y-m-d'), $endLocal->format('Y-m-d')]);
    $morningCheckins = 0;
    $eveningCheckins = 0;
    $breakfastDays = 0;
    $morningEnergyTotal = 0;
    $morningEnergyCount = 0;
    $eveningEnergyTotal = 0;
    $eveningEnergyCount = 0;
    $wakeMinutesTotal = 0;
    $wakeMinutesCount = 0;
    $dailyFocusSelected = 0;
    $dailyFocusCompleted = 0;
    foreach ($checkinStatement->fetchAll() as $checkin) {
        $date = (string) $checkin['local_date'];
        if (!isset($days[$date])) {
            continue;
        }
        if (!empty($checkin['morning_completed_at'])) {
            $morningCheckins++;
        }
        if (!empty($checkin['closed_at'])) {
            $eveningCheckins++;
            $days[$date]['closed'] = true;
        }
        if ($checkin['had_breakfast'] !== null) {
            $days[$date]['hadBreakfast'] = (bool) $checkin['had_breakfast'];
            $breakfastDays += (int) (bool) $checkin['had_breakfast'];
        }
        if ($checkin['morning_energy'] !== null) {
            $energy = (int) $checkin['morning_energy'];
            $days[$date]['morningEnergy'] = $energy;
            $morningEnergyTotal += $energy;
            $morningEnergyCount++;
        }
        if ($checkin['evening_energy'] !== null) {
            $energy = (int) $checkin['evening_energy'];
            $days[$date]['eveningEnergy'] = $energy;
            $eveningEnergyTotal += $energy;
            $eveningEnergyCount++;
        }
        if (!empty($checkin['wake_time'])) {
            $wakeTime = substr((string) $checkin['wake_time'], 0, 5);
            $days[$date]['wakeTime'] = $wakeTime;
            [$wakeHour, $wakeMinute] = array_map('intval', explode(':', $wakeTime));
            $wakeMinutesTotal += $wakeHour * 60 + $wakeMinute;
            $wakeMinutesCount++;
        }
        if ($checkin['daily_focus_task_id'] !== null) {
            $dailyFocusSelected++;
            $days[$date]['focusSelected'] = true;
            if (($checkin['focus_task_status'] ?? null) === 'completed') {
                $dailyFocusCompleted++;
                $days[$date]['focusCompleted'] = true;
            }
        }
    }

    $decisionStatement = $db->prepare(
        'SELECT action, COUNT(*) AS decision_count FROM daily_task_decisions
         WHERE user_id = ? AND local_date >= ? AND local_date < ? GROUP BY action'
    );
    $decisionStatement->execute([$userId, $startLocal->format('Y-m-d'), $endLocal->format('Y-m-d')]);
    $carryovers = ['tomorrow' => 0, 'later' => 0, 'drop' => 0];
    foreach ($decisionStatement->fetchAll() as $decision) {
        if (isset($carryovers[$decision['action']])) {
            $carryovers[$decision['action']] = (int) $decision['decision_count'];
        }
    }

    $reasonStatement = $db->prepare(
        'SELECT failure_reason, COUNT(*) AS reason_count FROM daily_task_decisions
         WHERE user_id = ? AND local_date >= ? AND local_date < ? AND failure_reason IS NOT NULL
         GROUP BY failure_reason ORDER BY reason_count DESC, failure_reason'
    );
    $reasonStatement->execute([$userId, $startLocal->format('Y-m-d'), $endLocal->format('Y-m-d')]);
    $failureReasons = array_map(static fn (array $reason): array => [
        'reason' => (string) $reason['failure_reason'],
        'count' => (int) $reason['reason_count'],
    ], $reasonStatement->fetchAll());
    arsort($rescueReasonCounts);
    $rescueReasons = array_map(
        static fn (string $reason, int $count): array => ['reason' => $reason, 'count' => $count],
        array_keys($rescueReasonCounts),
        array_values($rescueReasonCounts),
    );

    $overdueStatement = $db->prepare("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status NOT IN ('completed', 'cancelled') AND due_at < UTC_TIMESTAMP()");
    $overdueStatement->execute([$userId]);
    foreach ($days as &$day) {
        $day['completionRate'] = $day['total'] > 0 ? (int) round(($day['completed'] / $day['total']) * 100) : 0;
    }
    unset($day);
    $averageWakeMinutes = $wakeMinutesCount > 0 ? (int) round($wakeMinutesTotal / $wakeMinutesCount) : null;

    return [
        'weekStart' => $startLocal->format('Y-m-d'),
        'weekEnd' => $endLocal->modify('-1 day')->format('Y-m-d'),
        'total' => $total,
        'completed' => $completed,
        'completionRate' => $total > 0 ? (int) round(($completed / $total) * 100) : 0,
        'plannedMinutes' => $plannedMinutes,
        'completedMinutes' => $completedMinutes,
        'focusPlannedMinutes' => $focusPlannedMinutes,
        'focusActualMinutes' => (int) round($focusActualSeconds / 60),
        'rescueStarts' => $rescueStarts,
        'rescueContinued' => $rescueContinued,
        'rescueMinutes' => (int) round($rescueSeconds / 60),
        'rescueReasons' => $rescueReasons,
        'overdue' => (int) $overdueStatement->fetchColumn(),
        'dailyFocusSelected' => $dailyFocusSelected,
        'dailyFocusCompleted' => $dailyFocusCompleted,
        'dailyFocusRate' => $dailyFocusSelected > 0 ? (int) round(($dailyFocusCompleted / $dailyFocusSelected) * 100) : 0,
        'morningCheckins' => $morningCheckins,
        'eveningCheckins' => $eveningCheckins,
        'breakfastDays' => $breakfastDays,
        'averageMorningEnergy' => $morningEnergyCount > 0 ? round($morningEnergyTotal / $morningEnergyCount, 1) : null,
        'averageEveningEnergy' => $eveningEnergyCount > 0 ? round($eveningEnergyTotal / $eveningEnergyCount, 1) : null,
        'averageWakeTime' => $averageWakeMinutes === null ? null : sprintf('%02d:%02d', intdiv($averageWakeMinutes, 60), $averageWakeMinutes % 60),
        'calibrationSamples' => $calibrationSamples,
        'calibrationEstimatedMinutes' => $calibrationEstimatedMinutes,
        'calibrationActualMinutes' => $calibrationActualMinutes,
        'estimateAccuracy' => $calibrationEstimatedMinutes > 0
            ? max(0, (int) round(100 - ($calibrationAbsoluteError / $calibrationEstimatedMinutes * 100)))
            : null,
        'failureReasons' => $failureReasons,
        'carryovers' => $carryovers,
        'days' => array_values($days),
    ];
}

function reviewLocalDate(mixed $value, DateTimeZone $zone): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return (new DateTimeImmutable((string) $value, new DateTimeZone('UTC')))->setTimezone($zone)->format('Y-m-d');
}

function settingsView(array $row): array
{
    return [
        'displayName' => $row['display_name'] ?? 'Sakura',
        'email' => $row['email'] ?? '',
        'timezone' => $row['timezone'] ?? 'Europe/Berlin',
        'emailReminders' => (bool) ($row['email_reminders'] ?? true),
        'pushTaskReminders' => (bool) ($row['push_task_reminders'] ?? true),
        'dailySummary' => (bool) ($row['daily_summary'] ?? true),
        'pushDailySummary' => (bool) ($row['push_daily_summary'] ?? true),
        'dailySummaryTime' => $row['daily_summary_time'] ?? '21:30:00',
        'overdueReminder' => (bool) ($row['overdue_reminder'] ?? false),
        'pushOverdueReminder' => (bool) ($row['push_overdue_reminder'] ?? false),
        'taskReminderMinutes' => (int) ($row['task_reminder_minutes'] ?? 10),
        'weekStartsOn' => $row['week_starts_on'] ?? 'monday',
        'planningStartTime' => substr((string) ($row['planning_start_time'] ?? '09:00:00'), 0, 5),
        'planningEndTime' => substr((string) ($row['planning_end_time'] ?? '23:30:00'), 0, 5),
        'lunchStartTime' => substr((string) ($row['lunch_start_time'] ?? '12:30:00'), 0, 5),
        'lunchEndTime' => substr((string) ($row['lunch_end_time'] ?? '13:30:00'), 0, 5),
        'dinnerStartTime' => substr((string) ($row['dinner_start_time'] ?? '18:00:00'), 0, 5),
        'dinnerEndTime' => substr((string) ($row['dinner_end_time'] ?? '19:00:00'), 0, 5),
        'planningBufferMinutes' => (int) ($row['planning_buffer_minutes'] ?? 15),
    ];
}

function userView(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'email' => $user['email'],
        'displayName' => $user['display_name'],
        'timezone' => $user['timezone'],
    ];
}

function nullableString(mixed $value): ?string
{
    if ($value === null) {
        return null;
    }
    $string = trim((string) $value);
    return $string === '' ? null : $string;
}

function nullableInt(mixed $value): ?int
{
    return $value === null || $value === '' ? null : (int) $value;
}

function validPriority(string $value): string
{
    return in_array($value, ['low', 'medium', 'high'], true) ? $value : 'medium';
}

function validStatus(string $value): string
{
    return in_array($value, ['inbox', 'planned', 'in_progress', 'completed', 'cancelled'], true) ? $value : 'inbox';
}

function validEnergy(mixed $value): ?int
{
    $energy = (int) $value;
    return $energy >= 1 && $energy <= 5 ? $energy : null;
}

function validFailureReason(mixed $value): ?string
{
    $reason = nullableString($value);
    return $reason !== null && in_array($reason, ['time', 'energy', 'interrupted', 'difficult', 'resistance', 'changed'], true)
        ? $reason
        : null;
}

function validScheduleMode(string $value): string
{
    return in_array($value, ['fixed', 'window', 'flexible'], true) ? $value : 'flexible';
}

function validTime(?string $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $value)) {
        Http::json(['error' => '时间格式不正确。'], 422);
    }
    return substr($value, 0, 5) . ':00';
}

function validFrequency(string $value): string
{
    return in_array($value, ['daily', 'weekly', 'custom'], true) ? $value : 'daily';
}

function validColor(string $value): string
{
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? strtolower($value) : '#496d5b';
}
