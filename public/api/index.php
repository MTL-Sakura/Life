<?php

declare(strict_types=1);

use Life\Auth;
use Life\AiPlanner;
use Life\AiPlannerException;
use Life\Database;
use Life\DateTimes;
use Life\Http;
use Life\Mailer;
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

        $statement = $db->prepare(
            'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, recurrence_rule, reminder_minutes, reminder_at)
             VALUES (:user_id, :project_id, :category_id, :title, :notes, :status, :priority, :start_at, :end_at, :due_at, :estimated_minutes, :recurrence_rule, :reminder_minutes, :reminder_at)'
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
            'recurrence_rule' => nullableString($input['recurrenceRule'] ?? null),
            'reminder_minutes' => $reminderMinutes,
            'reminder_at' => $reminderAt,
        ]);
        $taskId = (int) $db->lastInsertId();
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
            'recurrenceRule' => 'recurrence_rule',
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
            } elseif ($inputKey === 'recurrenceRule') {
                $value = nullableString($value);
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
        }

        $effectiveStart = array_key_exists('start_at', $updates) ? $updates['start_at'] : $current['start_at'];
        $effectiveReminderMinutes = array_key_exists('reminder_minutes', $updates) ? $updates['reminder_minutes'] : $current['reminder_minutes'];
        if (array_key_exists('start_at', $updates) || array_key_exists('reminder_minutes', $updates)) {
            $updates['reminder_at'] = reminderAt($effectiveStart, $effectiveReminderMinutes === null ? null : (int) $effectiveReminderMinutes);
            $updates['reminder_sent_at'] = null;
        }

        $subtasksChanged = array_key_exists('subtasks', $input);
        if ($updates === [] && !$subtasksChanged) {
            Http::json(['task' => findTask($db, $taskId, $userId, $timezone)]);
        }

        $shouldGenerateNext = array_key_exists('completed', $input)
            && (bool) $input['completed']
            && $current['status'] !== 'completed'
            && nullableString($current['recurrence_rule'] ?? null) !== null;
        $nextTaskId = null;
        $db->beginTransaction();
        try {
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
            if ($shouldGenerateNext) {
                $nextTaskId = createNextRecurringTask($db, ownedRow($db, 'tasks', $taskId, $userId));
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
        Http::json(userDataExport($db, $userId, $timezone));

    case 'settings.update':
        Http::requireMethod('PATCH', 'POST');
        $input = Http::input();
        $db->beginTransaction();
        try {
            $db->prepare('UPDATE users SET display_name = ?, email = ?, timezone = ? WHERE id = ?')->execute([
                trim((string) ($input['displayName'] ?? $user['display_name'])),
                trim((string) ($input['email'] ?? $user['email'])),
                (string) ($input['timezone'] ?? $timezone),
                $userId,
            ]);
            $db->prepare(
                'INSERT INTO user_settings (user_id, email_reminders, daily_summary, daily_summary_time, overdue_reminder, task_reminder_minutes, week_starts_on)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE email_reminders = VALUES(email_reminders), daily_summary = VALUES(daily_summary), daily_summary_time = VALUES(daily_summary_time), overdue_reminder = VALUES(overdue_reminder), task_reminder_minutes = VALUES(task_reminder_minutes), week_starts_on = VALUES(week_starts_on)'
            )->execute([
                $userId,
                (int) (bool) ($input['emailReminders'] ?? true),
                (int) (bool) ($input['dailySummary'] ?? true),
                (string) ($input['dailySummaryTime'] ?? '21:30:00'),
                (int) (bool) ($input['overdueReminder'] ?? false),
                max(0, min(10080, (int) ($input['taskReminderMinutes'] ?? 10))),
                in_array(($input['weekStartsOn'] ?? 'monday'), ['monday', 'sunday'], true) ? $input['weekStartsOn'] : 'monday',
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
    $tasksStatement = $db->prepare(
        'SELECT tasks.*, projects.title AS project_title, categories.name AS category_name, categories.color AS category_color
         FROM tasks
         LEFT JOIN projects ON projects.id = tasks.project_id
         LEFT JOIN categories ON categories.id = tasks.category_id
         WHERE tasks.user_id = ? AND tasks.status != "cancelled"
         ORDER BY tasks.status = "completed", tasks.start_at IS NULL, tasks.start_at, tasks.created_at DESC'
    );
    $tasksStatement->execute([$userId]);
    $taskRows = $tasksStatement->fetchAll();
    $subtasks = subtaskMap($db, array_map(static fn (array $row): int => (int) $row['id'], $taskRows));
    $tasks = array_map(
        static fn (array $row): array => Views::task($row, $timezone, $subtasks[(int) $row['id']] ?? []),
        $taskRows
    );

    $categoryStatement = $db->prepare('SELECT id, name, color FROM categories WHERE user_id = ? ORDER BY id');
    $categoryStatement->execute([$userId]);
    $categories = array_map(static fn (array $row): array => ['id' => (int) $row['id'], 'name' => $row['name'], 'color' => $row['color']], $categoryStatement->fetchAll());

    $projectStatement = $db->prepare(
        'SELECT projects.*, COUNT(tasks.id) AS total_tasks, SUM(tasks.status = "completed") AS completed_tasks
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
        'settings' => settingsView($settingsRow),
        'review' => reviewData($db, $userId, $weekStartUtc, $weekEndUtc),
        'csrfToken' => Auth::csrfToken(),
    ];
}

function findTask(PDO $db, int $taskId, int $userId, string $timezone): array
{
    $statement = $db->prepare(
        'SELECT tasks.*, projects.title AS project_title, categories.name AS category_name, categories.color AS category_color
         FROM tasks LEFT JOIN projects ON projects.id = tasks.project_id LEFT JOIN categories ON categories.id = tasks.category_id
         WHERE tasks.id = ? AND tasks.user_id = ? LIMIT 1'
    );
    $statement->execute([$taskId, $userId]);
    $task = $statement->fetch();
    if (!$task) {
        Http::json(['error' => '任务不存在。'], 404);
    }

    return Views::task($task, $timezone, taskSubtasks($db, $taskId));
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

function createNextRecurringTask(PDO $db, array $task): ?int
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

    $statement = $db->prepare(
        'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, recurrence_rule, recurrence_source_task_id, reminder_minutes, reminder_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        (int) $task['user_id'],
        nullableInt($task['project_id'] ?? null),
        nullableInt($task['category_id'] ?? null),
        $task['title'],
        $task['notes'] ?? '',
        $nextStart === null ? 'inbox' : 'planned',
        $task['priority'],
        $nextStart,
        $nextEnd,
        $nextDue,
        (int) $task['estimated_minutes'],
        $task['recurrence_rule'],
        (int) $task['id'],
        $reminderMinutes,
        reminderAt($nextStart, $reminderMinutes),
    ]);
    $nextTaskId = (int) $db->lastInsertId();
    $copy = $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) SELECT ?, title, 0, position FROM subtasks WHERE task_id = ?');
    $copy->execute([$nextTaskId, (int) $task['id']]);
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

function reviewData(PDO $db, int $userId, string $weekStart, string $weekEnd): array
{
    $statement = $db->prepare(
        'SELECT COUNT(CASE WHEN
                    (start_at >= ? AND start_at < ?)
                    OR (due_at >= ? AND due_at < ?)
                    OR (completed_at >= ? AND completed_at < ?)
                THEN 1 END) AS total,
                SUM(status = "completed" AND completed_at >= ? AND completed_at < ?) AS completed,
                COALESCE(SUM(CASE WHEN status = "completed" AND completed_at >= ? AND completed_at < ? THEN estimated_minutes ELSE 0 END), 0) AS completed_minutes,
                SUM(status != "completed" AND due_at < UTC_TIMESTAMP()) AS overdue
         FROM tasks WHERE user_id = ? AND status != "cancelled"'
    );
    $statement->execute([
        $weekStart, $weekEnd,
        $weekStart, $weekEnd,
        $weekStart, $weekEnd,
        $weekStart, $weekEnd,
        $weekStart, $weekEnd,
        $userId,
    ]);
    $row = $statement->fetch() ?: [];
    $total = (int) ($row['total'] ?? 0);
    $completed = (int) ($row['completed'] ?? 0);

    return [
        'total' => $total,
        'completed' => $completed,
        'completionRate' => $total > 0 ? (int) round(($completed / $total) * 100) : 0,
        'completedMinutes' => (int) ($row['completed_minutes'] ?? 0),
        'overdue' => (int) ($row['overdue'] ?? 0),
    ];
}

function settingsView(array $row): array
{
    return [
        'displayName' => $row['display_name'] ?? 'Sakura',
        'email' => $row['email'] ?? '',
        'timezone' => $row['timezone'] ?? 'Europe/Berlin',
        'emailReminders' => (bool) ($row['email_reminders'] ?? true),
        'dailySummary' => (bool) ($row['daily_summary'] ?? true),
        'dailySummaryTime' => $row['daily_summary_time'] ?? '21:30:00',
        'overdueReminder' => (bool) ($row['overdue_reminder'] ?? false),
        'taskReminderMinutes' => (int) ($row['task_reminder_minutes'] ?? 10),
        'weekStartsOn' => $row['week_starts_on'] ?? 'monday',
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

function userDataExport(PDO $db, int $userId, string $timezone): array
{
    $queries = [
        'account' => 'SELECT username, email, display_name, timezone, created_at, updated_at FROM users WHERE id = ?',
        'settings' => 'SELECT email_reminders, daily_summary, daily_summary_time, overdue_reminder, task_reminder_minutes, week_starts_on, updated_at FROM user_settings WHERE user_id = ?',
        'categories' => 'SELECT id, name, color, created_at FROM categories WHERE user_id = ? ORDER BY id',
        'projects' => 'SELECT * FROM projects WHERE user_id = ? ORDER BY id',
        'projectStages' => 'SELECT project_stages.* FROM project_stages INNER JOIN projects ON projects.id = project_stages.project_id WHERE projects.user_id = ? ORDER BY project_stages.project_id, project_stages.position',
        'tasks' => 'SELECT * FROM tasks WHERE user_id = ? ORDER BY id',
        'subtasks' => 'SELECT subtasks.* FROM subtasks INNER JOIN tasks ON tasks.id = subtasks.task_id WHERE tasks.user_id = ? ORDER BY subtasks.task_id, subtasks.position',
        'habits' => 'SELECT * FROM habits WHERE user_id = ? ORDER BY id',
        'habitLogs' => 'SELECT habit_logs.* FROM habit_logs INNER JOIN habits ON habits.id = habit_logs.habit_id WHERE habits.user_id = ? ORDER BY habit_logs.habit_id, habit_logs.log_date',
        'notifications' => 'SELECT type, reference_key, sent_at, created_at FROM notification_logs WHERE user_id = ? ORDER BY id',
        'aiPlans' => 'SELECT id, status, model, source_task_ids, target_start_date, target_end_date, proposal_json, error_message, input_tokens, output_tokens, expires_at, applied_at, created_at, updated_at FROM ai_plans WHERE user_id = ? ORDER BY id',
    ];

    $data = [];
    foreach ($queries as $key => $sql) {
        $statement = $db->prepare($sql);
        $statement->execute([$userId]);
        $rows = $statement->fetchAll();
        $data[$key] = in_array($key, ['account', 'settings'], true) ? ($rows[0] ?? null) : $rows;
    }

    return [
        'schemaVersion' => 3,
        'exportedAt' => gmdate('c'),
        'timezone' => $timezone,
        'data' => $data,
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

function validFrequency(string $value): string
{
    return in_array($value, ['daily', 'weekly', 'custom'], true) ? $value : 'daily';
}

function validColor(string $value): string
{
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? strtolower($value) : '#496d5b';
}
