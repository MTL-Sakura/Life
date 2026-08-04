<?php

declare(strict_types=1);

namespace Life;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;

final class PlanImporter
{
    public function import(PDO $db, int $userId, string $timezone, array $document): array
    {
        $plan = $this->normalize($document, $timezone);
        $db->beginTransaction();
        try {
            $duplicate = $db->prepare('SELECT id FROM plan_imports WHERE user_id = ? AND import_key = ? LIMIT 1');
            $duplicate->execute([$userId, $plan['importKey']]);
            if ($duplicate->fetchColumn()) {
                throw new PlanImportException('这份计划已经导入过了，请不要重复导入。', 409);
            }

            $categoryInsert = $db->prepare('INSERT IGNORE INTO categories (user_id, name, color) VALUES (?, ?, ?)');
            foreach ($plan['categories'] as $category) {
                $categoryInsert->execute([$userId, $category['name'], $category['color']]);
            }

            $categoryStatement = $db->prepare('SELECT id, name FROM categories WHERE user_id = ?');
            $categoryStatement->execute([$userId]);
            $categoryMap = [];
            foreach ($categoryStatement->fetchAll() as $category) {
                $categoryMap[(string) $category['name']] = (int) $category['id'];
            }

            $projectInsert = $db->prepare(
                'INSERT INTO projects (user_id, title, description, area, color, status, progress, current_stage)
                 VALUES (?, ?, ?, ?, ?, "active", 0, ?)'
            );
            $stageInsert = $db->prepare('INSERT INTO project_stages (project_id, title, position) VALUES (?, ?, ?)');
            $projectMap = [];
            foreach ($plan['projects'] as $project) {
                $projectInsert->execute([
                    $userId,
                    $project['title'],
                    $project['description'],
                    $project['area'],
                    $project['color'],
                    $project['currentStage'],
                ]);
                $projectId = (int) $db->lastInsertId();
                $projectMap[$project['key']] = $projectId;
                foreach ($project['stages'] as $position => $stage) {
                    $stageInsert->execute([$projectId, $stage, $position]);
                }
            }

            $habitInsert = $db->prepare(
                'INSERT INTO habits (user_id, name, description, color, frequency_type, target_count, schedule_days, start_date, reminder_time, allow_makeup)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            foreach ($plan['habits'] as $habit) {
                $habitInsert->execute([
                    $userId,
                    $habit['name'],
                    $habit['description'],
                    $habit['color'],
                    $habit['frequency'],
                    $habit['targetCount'],
                    json_encode($habit['scheduleDays'], JSON_THROW_ON_ERROR),
                    $plan['startDate']->format('Y-m-d'),
                    $habit['reminderTime'],
                    (int) $habit['allowMakeup'],
                ]);
            }

            $taskInsert = $db->prepare(
                'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, recurrence_rule, reminder_minutes, reminder_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $subtaskInsert = $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) VALUES (?, ?, 0, ?)');
            foreach ($plan['tasks'] as $task) {
                if ($task['category'] !== null && !isset($categoryMap[$task['category']])) {
                    $categoryInsert->execute([$userId, $task['category'], '#7a6b87']);
                    $categoryMap[$task['category']] = (int) $db->lastInsertId();
                }
                $taskDate = $this->taskDate($plan['startDate'], $task);
                $start = $task['startTime'] === null ? null : $taskDate->setTime(...$this->timeParts($task['startTime']));
                $end = $start?->add(new DateInterval('PT' . $task['duration'] . 'M'));
                if ($end !== null && $end->format('Y-m-d') !== $taskDate->format('Y-m-d')) {
                    throw new PlanImportException("任务“{$task['title']}”不能跨越午夜。", 422);
                }
                $due = $task['dueTime'] === null ? null : $taskDate->setTime(...$this->timeParts($task['dueTime']));
                if ($start !== null && $due !== null && $due < $start) {
                    throw new PlanImportException("任务“{$task['title']}”的截止时间早于开始时间。", 422);
                }
                $startUtc = $this->utc($start);
                $endUtc = $this->utc($end);
                $dueUtc = $this->utc($due);
                $reminder = $start?->sub(new DateInterval('PT' . $task['reminderMinutes'] . 'M'));
                $taskInsert->execute([
                    $userId,
                    $task['projectKey'] === null ? null : $projectMap[$task['projectKey']],
                    $task['category'] === null ? null : $categoryMap[$task['category']],
                    $task['title'],
                    $task['notes'],
                    $start === null ? 'inbox' : 'planned',
                    $task['priority'],
                    $startUtc,
                    $endUtc,
                    $dueUtc,
                    $task['duration'],
                    $task['recurrence'],
                    $start === null ? null : $task['reminderMinutes'],
                    $this->utc($reminder),
                ]);
                $taskId = (int) $db->lastInsertId();
                foreach ($task['subtasks'] as $position => $subtask) {
                    $subtaskInsert->execute([$taskId, $subtask, $position]);
                }
            }

            $counts = [
                'categories' => count($plan['categories']),
                'projects' => count($plan['projects']),
                'habits' => count($plan['habits']),
                'tasks' => count($plan['tasks']),
            ];
            $record = $db->prepare('INSERT INTO plan_imports (user_id, import_key, document_name, imported_counts) VALUES (?, ?, ?, ?)');
            $record->execute([$userId, $plan['importKey'], $plan['name'], json_encode($counts, JSON_THROW_ON_ERROR)]);
            $db->commit();
            return $counts;
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            if ($error instanceof PlanImportException) {
                throw $error;
            }
            error_log((string) $error);
            throw new PlanImportException('计划导入失败，请检查 JSON 内容后重试。', 500);
        }
    }

    private function normalize(array $document, string $timezone): array
    {
        if ((int) ($document['schemaVersion'] ?? 0) !== 1) {
            throw new PlanImportException('不支持这个 JSON 版本，请使用 schemaVersion 1。');
        }
        $importKey = $this->requiredString($document, 'importKey', 120, 'importKey');
        if (!preg_match('/^[A-Za-z0-9._-]{3,120}$/', $importKey)) {
            throw new PlanImportException('importKey 只能包含字母、数字、点、下划线和短横线。');
        }
        $documentTimezone = trim((string) ($document['timezone'] ?? $timezone));
        if ($documentTimezone !== $timezone) {
            throw new PlanImportException("JSON 时区 {$documentTimezone} 与账户时区 {$timezone} 不一致。", 422);
        }
        $zone = new DateTimeZone($timezone);
        $startDate = $this->startDate((string) ($document['startDate'] ?? 'tomorrow'), $zone);
        $categories = $this->normalizeCategories($this->list($document, 'categories', 30));
        $projects = $this->normalizeProjects($this->list($document, 'projects', 30));
        $projectKeys = array_fill_keys(array_column($projects, 'key'), true);

        return [
            'importKey' => $importKey,
            'name' => $this->optionalString($document, 'name', 190) ?? '生活计划导入',
            'startDate' => $startDate,
            'categories' => $categories,
            'projects' => $projects,
            'habits' => $this->normalizeHabits($this->list($document, 'habits', 50)),
            'tasks' => $this->normalizeTasks($this->list($document, 'tasks', 200), $projectKeys),
        ];
    }

    private function normalizeCategories(array $items): array
    {
        $names = [];
        return array_map(function (array $item) use (&$names): array {
            $name = $this->requiredString($item, 'name', 80, '分类名称');
            if (isset($names[$name])) {
                throw new PlanImportException("分类“{$name}”重复。", 422);
            }
            $names[$name] = true;
            return ['name' => $name, 'color' => $this->color((string) ($item['color'] ?? '#496d5b'))];
        }, $items);
    }

    private function normalizeProjects(array $items): array
    {
        $keys = [];
        return array_map(function (array $item) use (&$keys): array {
            $key = $this->requiredString($item, 'key', 80, '项目 key');
            if (!preg_match('/^[A-Za-z0-9._-]+$/', $key) || isset($keys[$key])) {
                throw new PlanImportException("项目 key“{$key}”无效或重复。", 422);
            }
            $keys[$key] = true;
            $stages = $this->stringList($item['stages'] ?? [], 20, 190, '项目阶段');
            return [
                'key' => $key,
                'title' => $this->requiredString($item, 'title', 190, '项目名称'),
                'description' => $this->optionalString($item, 'description', 2000) ?? '',
                'area' => $this->optionalString($item, 'area', 80) ?? '个人',
                'color' => $this->color((string) ($item['color'] ?? '#496d5b')),
                'currentStage' => $this->optionalString($item, 'currentStage', 190) ?? ($stages[0] ?? '确定下一步'),
                'stages' => $stages,
            ];
        }, $items);
    }

    private function normalizeHabits(array $items): array
    {
        return array_map(function (array $item): array {
            $frequency = (string) ($item['frequency'] ?? 'daily');
            if (!in_array($frequency, ['daily', 'weekly', 'custom'], true)) {
                throw new PlanImportException('习惯频率只能是 daily、weekly 或 custom。');
            }
            $days = array_values(array_unique(array_map('intval', (array) ($item['scheduleDays'] ?? [1, 2, 3, 4, 5, 6, 7]))));
            if ($days === [] || array_filter($days, static fn (int $day): bool => $day < 1 || $day > 7)) {
                throw new PlanImportException('习惯 scheduleDays 必须是 1 到 7。');
            }
            $reminderTime = $this->nullableTime($item['reminderTime'] ?? null, '习惯提醒时间');
            return [
                'name' => $this->requiredString($item, 'name', 190, '习惯名称'),
                'description' => $this->optionalString($item, 'description', 255) ?? '',
                'color' => $this->color((string) ($item['color'] ?? '#496d5b')),
                'frequency' => $frequency,
                'targetCount' => max(1, min(7, (int) ($item['targetCount'] ?? 1))),
                'scheduleDays' => $days,
                'reminderTime' => $reminderTime,
                'allowMakeup' => array_key_exists('allowMakeup', $item) ? (bool) $item['allowMakeup'] : true,
            ];
        }, $items);
    }

    private function normalizeTasks(array $items, array $projectKeys): array
    {
        return array_map(function (array $item) use ($projectKeys): array {
            $title = $this->requiredString($item, 'title', 255, '任务名称');
            $projectKey = $this->optionalString($item, 'projectKey', 80);
            if ($projectKey !== null && !isset($projectKeys[$projectKey])) {
                throw new PlanImportException("任务“{$title}”引用了不存在的项目 key。", 422);
            }
            $priority = (string) ($item['priority'] ?? 'medium');
            if (!in_array($priority, ['low', 'medium', 'high'], true)) {
                throw new PlanImportException("任务“{$title}”的优先级无效。", 422);
            }
            $recurrenceValue = (string) ($item['recurrence'] ?? 'none');
            $recurrence = match ($recurrenceValue) {
                'none' => null,
                'daily' => 'FREQ=DAILY',
                'weekly' => 'FREQ=WEEKLY',
                'monthly' => 'FREQ=MONTHLY',
                default => throw new PlanImportException("任务“{$title}”的重复规则无效。", 422),
            };
            $weekday = isset($item['weekday']) ? (int) $item['weekday'] : null;
            if ($weekday !== null && ($weekday < 1 || $weekday > 7)) {
                throw new PlanImportException("任务“{$title}”的 weekday 必须是 1 到 7。", 422);
            }
            return [
                'title' => $title,
                'notes' => $this->optionalString($item, 'notes', 4000) ?? '',
                'projectKey' => $projectKey,
                'category' => $this->optionalString($item, 'category', 80),
                'priority' => $priority,
                'duration' => max(1, min(1440, (int) ($item['duration'] ?? 30))),
                'dateOffset' => max(0, min(365, (int) ($item['dateOffset'] ?? 0))),
                'weekday' => $weekday,
                'startTime' => $this->nullableTime($item['startTime'] ?? null, "任务“{$title}”的开始时间"),
                'dueTime' => $this->nullableTime($item['dueTime'] ?? null, "任务“{$title}”的截止时间"),
                'recurrence' => $recurrence,
                'reminderMinutes' => max(0, min(10080, (int) ($item['reminderMinutes'] ?? 10))),
                'subtasks' => $this->stringList($item['subtasks'] ?? [], 20, 255, "任务“{$title}”的子任务"),
            ];
        }, $items);
    }

    private function list(array $document, string $key, int $limit): array
    {
        $value = $document[$key] ?? [];
        if (!is_array($value) || !array_is_list($value) || count($value) > $limit) {
            throw new PlanImportException("{$key} 必须是数组，且最多包含 {$limit} 项。", 422);
        }
        foreach ($value as $item) {
            if (!is_array($item)) {
                throw new PlanImportException("{$key} 中的每一项都必须是对象。", 422);
            }
        }
        return $value;
    }

    private function stringList(mixed $value, int $limit, int $maxLength, string $label): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > $limit) {
            throw new PlanImportException("{$label}必须是数组，且最多包含 {$limit} 项。", 422);
        }
        $result = [];
        foreach ($value as $item) {
            $string = trim((string) $item);
            if ($string === '' || strlen($string) > $maxLength) {
                throw new PlanImportException("{$label}包含空值或过长内容。", 422);
            }
            $result[] = $string;
        }
        return $result;
    }

    private function requiredString(array $data, string $key, int $maxLength, string $label): string
    {
        $value = trim((string) ($data[$key] ?? ''));
        if ($value === '' || strlen($value) > $maxLength) {
            throw new PlanImportException("{$label}不能为空或超过 {$maxLength} 个字符。", 422);
        }
        return $value;
    }

    private function optionalString(array $data, string $key, int $maxLength): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null) {
            return null;
        }
        $value = trim((string) $data[$key]);
        if ($value === '') {
            return null;
        }
        if (strlen($value) > $maxLength) {
            throw new PlanImportException("{$key} 内容过长。", 422);
        }
        return $value;
    }

    private function nullableTime(mixed $value, string $label): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $time = trim((string) $value);
        if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time)) {
            throw new PlanImportException("{$label}必须使用 HH:MM 格式。", 422);
        }
        return $time;
    }

    private function startDate(string $value, DateTimeZone $zone): DateTimeImmutable
    {
        $today = new DateTimeImmutable('today', $zone);
        if ($value === 'today') {
            return $today;
        }
        if ($value === 'tomorrow' || $value === '') {
            return $today->modify('+1 day');
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $zone);
        if ($date === false || $date->format('Y-m-d') !== $value || $date < $today) {
            throw new PlanImportException('startDate 必须是 today、tomorrow 或不早于今天的 YYYY-MM-DD。', 422);
        }
        return $date;
    }

    private function taskDate(DateTimeImmutable $startDate, array $task): DateTimeImmutable
    {
        if ($task['weekday'] !== null) {
            $offset = ($task['weekday'] - (int) $startDate->format('N') + 7) % 7;
            return $startDate->modify("+{$offset} days");
        }
        return $startDate->modify('+' . $task['dateOffset'] . ' days');
    }

    private function timeParts(string $time): array
    {
        return array_map('intval', explode(':', $time));
    }

    private function utc(?DateTimeImmutable $value): ?string
    {
        return $value?->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function color(string $value): string
    {
        return preg_match('/^#[0-9a-fA-F]{6}$/', $value) ? strtolower($value) : '#496d5b';
    }
}
