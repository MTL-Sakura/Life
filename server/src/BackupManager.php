<?php

declare(strict_types=1);

namespace Life;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use PDO;
use RuntimeException;
use Throwable;

final class BackupManager
{
    public const SCHEMA_VERSION = 7;

    public function export(PDO $db, int $userId, string $timezone): array
    {
        $queries = [
            'account' => 'SELECT username, email, display_name, timezone, created_at, updated_at FROM users WHERE id = ?',
            'settings' => 'SELECT email_reminders, daily_summary, daily_summary_time, overdue_reminder, task_reminder_minutes, week_starts_on, planning_start_time, planning_end_time, lunch_start_time, lunch_end_time, dinner_start_time, dinner_end_time, planning_buffer_minutes, updated_at FROM user_settings WHERE user_id = ?',
            'categories' => 'SELECT id, name, color, created_at FROM categories WHERE user_id = ? ORDER BY id',
            'projects' => 'SELECT * FROM projects WHERE user_id = ? ORDER BY id',
            'projectStages' => 'SELECT project_stages.* FROM project_stages INNER JOIN projects ON projects.id = project_stages.project_id WHERE projects.user_id = ? ORDER BY project_stages.project_id, project_stages.position',
            'taskSeries' => 'SELECT id, recurrence_rule, paused_until, created_at, updated_at FROM task_series WHERE user_id = ? ORDER BY id',
            'tasks' => 'SELECT * FROM tasks WHERE user_id = ? ORDER BY id',
            'scheduleBlocks' => 'SELECT id, task_id, start_at, end_at, source, position, created_at FROM task_schedule_blocks WHERE user_id = ? ORDER BY task_id, position',
            'focusSessions' => 'SELECT * FROM focus_sessions WHERE user_id = ? ORDER BY id',
            'subtasks' => 'SELECT subtasks.* FROM subtasks INNER JOIN tasks ON tasks.id = subtasks.task_id WHERE tasks.user_id = ? ORDER BY subtasks.task_id, subtasks.position',
            'habits' => 'SELECT * FROM habits WHERE user_id = ? ORDER BY id',
            'habitLogs' => 'SELECT habit_logs.* FROM habit_logs INNER JOIN habits ON habits.id = habit_logs.habit_id WHERE habits.user_id = ? ORDER BY habit_logs.habit_id, habit_logs.log_date',
            'notifications' => 'SELECT type, reference_key, sent_at, created_at FROM notification_logs WHERE user_id = ? ORDER BY id',
            'aiPlans' => 'SELECT id, status, model, source_task_ids, target_start_date, target_end_date, proposal_json, error_message, input_tokens, output_tokens, expires_at, applied_at, created_at, updated_at FROM ai_plans WHERE user_id = ? ORDER BY id',
            'planImports' => 'SELECT id, import_key, document_name, imported_counts, created_at FROM plan_imports WHERE user_id = ? ORDER BY id',
            'planImportItems' => 'SELECT plan_import_items.id, plan_import_items.plan_import_id, plan_import_items.entity_type, plan_import_items.entity_id, plan_import_items.created_at FROM plan_import_items INNER JOIN plan_imports ON plan_imports.id = plan_import_items.plan_import_id WHERE plan_imports.user_id = ? ORDER BY plan_import_items.id',
            'dailyCheckins' => 'SELECT * FROM daily_checkins WHERE user_id = ? ORDER BY local_date, id',
        ];

        $data = [];
        foreach ($queries as $key => $sql) {
            $statement = $db->prepare($sql);
            $statement->execute([$userId]);
            $rows = $statement->fetchAll();
            $data[$key] = in_array($key, ['account', 'settings'], true) ? ($rows[0] ?? null) : $rows;
        }

        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'exportedAt' => gmdate('c'),
            'timezone' => $timezone,
            'data' => $data,
        ];
    }

    public function preview(array $backup): array
    {
        $version = (int) ($backup['schemaVersion'] ?? 0);
        if ($version < 5 || $version > self::SCHEMA_VERSION) {
            throw new RuntimeException('这份备份版本不受支持。');
        }
        $data = $backup['data'] ?? null;
        if (!is_array($data) || !is_array($data['tasks'] ?? null)) {
            throw new RuntimeException('备份内容不完整或格式不正确。');
        }

        return [
            'schemaVersion' => $version,
            'exportedAt' => (string) ($backup['exportedAt'] ?? ''),
            'timezone' => (string) ($backup['timezone'] ?? 'Europe/Berlin'),
            'counts' => [
                'tasks' => count((array) ($data['tasks'] ?? [])),
                'projects' => count((array) ($data['projects'] ?? [])),
                'habits' => count((array) ($data['habits'] ?? [])),
                'categories' => count((array) ($data['categories'] ?? [])),
                'focusSessions' => count((array) ($data['focusSessions'] ?? [])),
            ],
        ];
    }

    public function create(PDO $db, int $userId, string $timezone, string $kind = 'manual'): array
    {
        if (!in_array($kind, ['manual', 'daily', 'weekly', 'pre_restore'], true)) {
            throw new RuntimeException('备份类型不正确。');
        }
        $backup = $this->export($db, $userId, $timezone);
        $directory = LIFE_ROOT . '/server/storage/backups';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('无法创建备份目录。');
        }
        $stamp = gmdate('Ymd-His');
        $random = bin2hex(random_bytes(4));
        $fileName = "life-{$kind}-{$stamp}-{$random}.json";
        $path = $directory . '/' . $fileName;
        try {
            $json = json_encode($backup, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('无法生成备份文件。', 0, $error);
        }
        if (file_put_contents($path, $json, LOCK_EX) === false) {
            throw new RuntimeException('无法写入备份文件。');
        }
        chmod($path, 0600);

        $statement = $db->prepare('INSERT INTO backup_records (user_id, kind, file_name, file_path, schema_version, size_bytes) VALUES (?, ?, ?, ?, ?, ?)');
        $statement->execute([$userId, $kind, $fileName, $path, self::SCHEMA_VERSION, strlen($json)]);
        $recordId = (int) $db->lastInsertId();
        $this->prune($db, $userId);
        return $this->record($db, $recordId, $userId);
    }

    public function records(PDO $db, int $userId): array
    {
        $statement = $db->prepare('SELECT id, kind, file_name, schema_version, size_bytes, created_at FROM backup_records WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30');
        $statement->execute([$userId]);
        return array_map([$this, 'recordView'], $statement->fetchAll());
    }

    public function stored(PDO $db, int $userId, int $backupId): array
    {
        $record = $this->record($db, $backupId, $userId, true);
        $raw = file_get_contents((string) $record['file_path']);
        if ($raw === false) {
            throw new RuntimeException('备份文件已经不存在。');
        }
        try {
            $backup = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('备份文件已经损坏。', 0, $error);
        }
        if (!is_array($backup)) {
            throw new RuntimeException('备份文件格式不正确。');
        }
        return $backup;
    }

    public function restore(PDO $db, int $userId, string $timezone, array $backup): void
    {
        $this->preview($backup);
        $this->create($db, $userId, $timezone, 'pre_restore');
        $data = (array) $backup['data'];

        $db->beginTransaction();
        try {
            foreach (['notification_logs', 'focus_sessions', 'task_schedule_blocks', 'subtasks', 'ai_plans', 'daily_checkins'] as $table) {
                $this->deleteOwned($db, $table, $userId);
            }
            $db->prepare('DELETE FROM plan_imports WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM tasks WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM task_series WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE project_stages FROM project_stages INNER JOIN projects ON projects.id = project_stages.project_id WHERE projects.user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM projects WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE habit_logs FROM habit_logs INNER JOIN habits ON habits.id = habit_logs.habit_id WHERE habits.user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM habits WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM categories WHERE user_id = ?')->execute([$userId]);

            $this->insertRows($db, 'categories', (array) ($data['categories'] ?? []), ['id', 'user_id', 'name', 'color', 'created_at'], $userId);
            $this->insertRows($db, 'projects', (array) ($data['projects'] ?? []), ['id', 'user_id', 'title', 'description', 'area', 'color', 'status', 'progress', 'due_at', 'current_stage', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'project_stages', (array) ($data['projectStages'] ?? []), ['id', 'project_id', 'title', 'position', 'completed', 'created_at']);
            $this->insertRows($db, 'task_series', (array) ($data['taskSeries'] ?? []), ['id', 'user_id', 'recurrence_rule', 'paused_until', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'tasks', (array) ($data['tasks'] ?? []), ['id', 'user_id', 'project_id', 'category_id', 'title', 'notes', 'status', 'priority', 'start_at', 'end_at', 'due_at', 'estimated_minutes', 'is_focus', 'recurrence_rule', 'recurrence_source_task_id', 'recurrence_series_id', 'occurrence_state', 'schedule_mode', 'window_start', 'window_end', 'reminder_minutes', 'reminder_at', 'reminder_sent_at', 'completed_at', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'task_schedule_blocks', (array) ($data['scheduleBlocks'] ?? []), ['id', 'user_id', 'task_id', 'start_at', 'end_at', 'source', 'position', 'created_at'], $userId);
            $this->insertRows($db, 'subtasks', (array) ($data['subtasks'] ?? []), ['id', 'task_id', 'title', 'completed', 'position', 'created_at']);
            $this->insertRows($db, 'focus_sessions', (array) ($data['focusSessions'] ?? []), ['id', 'user_id', 'task_id', 'status', 'planned_seconds', 'elapsed_seconds', 'started_at', 'last_resumed_at', 'ended_at', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'habits', (array) ($data['habits'] ?? []), ['id', 'user_id', 'name', 'description', 'color', 'frequency_type', 'target_count', 'schedule_days', 'start_date', 'reminder_time', 'allow_makeup', 'is_active', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'habit_logs', (array) ($data['habitLogs'] ?? []), ['id', 'habit_id', 'log_date', 'status', 'note', 'completed_at', 'created_at']);
            $this->insertRows($db, 'notification_logs', (array) ($data['notifications'] ?? []), ['id', 'user_id', 'type', 'reference_key', 'sent_at', 'created_at'], $userId);
            $this->insertRows($db, 'ai_plans', (array) ($data['aiPlans'] ?? []), ['id', 'user_id', 'status', 'model', 'source_task_ids', 'target_start_date', 'target_end_date', 'proposal_json', 'error_message', 'input_tokens', 'output_tokens', 'expires_at', 'applied_at', 'created_at', 'updated_at'], $userId);
            $this->insertRows($db, 'plan_imports', (array) ($data['planImports'] ?? []), ['id', 'user_id', 'import_key', 'document_name', 'imported_counts', 'created_at'], $userId);
            $this->insertRows($db, 'plan_import_items', (array) ($data['planImportItems'] ?? []), ['id', 'plan_import_id', 'entity_type', 'entity_id', 'created_at']);
            $this->insertRows($db, 'daily_checkins', (array) ($data['dailyCheckins'] ?? []), ['id', 'user_id', 'local_date', 'wake_time', 'had_breakfast', 'morning_energy', 'daily_focus_task_id', 'morning_completed_at', 'morning_skipped_at', 'evening_energy', 'reflection', 'closed_at', 'created_at', 'updated_at'], $userId);

            $settings = is_array($data['settings'] ?? null) ? $data['settings'] : [];
            $settings['user_id'] = $userId;
            $this->replaceSettings($db, $settings);
            $account = is_array($data['account'] ?? null) ? $data['account'] : [];
            $db->prepare('UPDATE users SET email = ?, display_name = ?, timezone = ? WHERE id = ?')->execute([
                (string) ($account['email'] ?? ''),
                (string) ($account['display_name'] ?? 'Sakura'),
                (string) ($account['timezone'] ?? $timezone),
                $userId,
            ]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
    }

    private function replaceSettings(PDO $db, array $settings): void
    {
        $defaults = [
            'email_reminders' => 1, 'daily_summary' => 1, 'daily_summary_time' => '21:30:00',
            'overdue_reminder' => 0, 'task_reminder_minutes' => 10, 'week_starts_on' => 'monday',
            'theme' => 'light', 'planning_start_time' => '09:00:00', 'planning_end_time' => '23:30:00',
            'lunch_start_time' => '12:30:00', 'lunch_end_time' => '13:30:00',
            'dinner_start_time' => '18:00:00', 'dinner_end_time' => '19:00:00', 'planning_buffer_minutes' => 15,
        ];
        $values = array_merge($defaults, $settings);
        $columns = array_keys($defaults);
        $placeholders = implode(', ', array_fill(0, count($columns) + 1, '?'));
        $updates = implode(', ', array_map(static fn (string $column): string => "{$column} = VALUES({$column})", $columns));
        $statement = $db->prepare('INSERT INTO user_settings (user_id, ' . implode(', ', $columns) . ") VALUES ({$placeholders}) ON DUPLICATE KEY UPDATE {$updates}");
        $statement->execute([$settings['user_id'], ...array_map(static fn (string $column): mixed => $values[$column], $columns)]);
    }

    private function insertRows(PDO $db, string $table, array $rows, array $allowedColumns, ?int $userId = null): void
    {
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            if ($userId !== null && in_array('user_id', $allowedColumns, true)) {
                $row['user_id'] = $userId;
            }
            $columns = array_values(array_filter($allowedColumns, static fn (string $column): bool => array_key_exists($column, $row)));
            if ($columns === []) {
                continue;
            }
            $sql = "INSERT INTO {$table} (" . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')';
            $statement = $db->prepare($sql);
            $statement->execute(array_map(static fn (string $column): mixed => $row[$column], $columns));
        }
    }

    private function deleteOwned(PDO $db, string $table, int $userId): void
    {
        $db->prepare("DELETE FROM {$table} WHERE user_id = ?")->execute([$userId]);
    }

    private function record(PDO $db, int $backupId, int $userId, bool $raw = false): array
    {
        $statement = $db->prepare('SELECT * FROM backup_records WHERE id = ? AND user_id = ? LIMIT 1');
        $statement->execute([$backupId, $userId]);
        $record = $statement->fetch();
        if (!$record) {
            throw new RuntimeException('备份记录不存在。');
        }
        return $raw ? $record : $this->recordView($record);
    }

    private function recordView(array $record): array
    {
        return [
            'id' => (int) $record['id'],
            'kind' => $record['kind'],
            'fileName' => $record['file_name'],
            'schemaVersion' => (int) $record['schema_version'],
            'sizeBytes' => (int) $record['size_bytes'],
            'createdAt' => (new DateTimeImmutable((string) $record['created_at'], new DateTimeZone('UTC')))->format(DATE_ATOM),
        ];
    }

    private function prune(PDO $db, int $userId): void
    {
        foreach (['daily' => 7, 'weekly' => 4, 'manual' => 10, 'pre_restore' => 10] as $kind => $keep) {
            $statement = $db->prepare('SELECT id, file_path FROM backup_records WHERE user_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 100 OFFSET ' . $keep);
            $statement->execute([$userId, $kind]);
            foreach ($statement->fetchAll() as $record) {
                $path = (string) $record['file_path'];
                if (is_file($path)) {
                    unlink($path);
                }
                $db->prepare('DELETE FROM backup_records WHERE id = ? AND user_id = ?')->execute([(int) $record['id'], $userId]);
            }
        }
    }
}
