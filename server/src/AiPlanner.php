<?php

declare(strict_types=1);

namespace Life;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use PDO;
use Throwable;

final class AiPlanner
{
    private const DAY_START = '08:00:00';
    private const DAY_END = '21:00:00';
    private const MAX_SOURCE_TASKS = 20;

    public function generate(PDO $db, int $userId, string $timezone): array
    {
        $apiKey = Config::get('OPENAI_API_KEY');
        if ($apiKey === null || trim($apiKey) === '') {
            throw new AiPlannerException('AI 服务尚未配置，请先填写 OpenAI API 密钥。', 503);
        }

        $zone = $this->timezone($timezone);
        $now = new DateTimeImmutable('now', $zone);
        $today = $now->setTime(0, 0);
        $windowEnd = $today->modify('+7 days');
        $dailyLimit = max(1, min(10, (int) Config::get('OPENAI_DAILY_LIMIT', '2')));
        $usedToday = $this->usageToday($db, $userId, $today);
        if ($usedToday >= $dailyLimit) {
            throw new AiPlannerException("今天的 AI 安排次数已经用完了，明天可以再使用 {$dailyLimit} 次。", 429);
        }

        $tasks = $this->sourceTasks($db, $userId, $timezone);
        if ($tasks === []) {
            throw new AiPlannerException('收集箱里没有需要安排的任务。');
        }

        $busy = $this->busyBlocks($db, $userId, $now, $windowEnd, $timezone);
        $model = trim((string) Config::get('OPENAI_MODEL', 'gpt-5.4-mini'));
        $expiresAt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 minutes');
        $sourceTaskIds = array_map(static fn (array $task): int => (int) $task['id'], $tasks);

        $insert = $db->prepare(
            'INSERT INTO ai_plans (user_id, status, model, source_task_ids, target_start_date, target_end_date, expires_at)
             VALUES (?, "generating", ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $userId,
            $model,
            json_encode($sourceTaskIds, JSON_THROW_ON_ERROR),
            $today->format('Y-m-d'),
            $windowEnd->modify('-1 day')->format('Y-m-d'),
            $expiresAt->format('Y-m-d H:i:s'),
        ]);
        $planId = (int) $db->lastInsertId();

        try {
            $response = $this->requestPlan($apiKey, $model, $timezone, $now, $windowEnd, $tasks, $busy);
            $proposal = $this->validateProposal($response['proposal'], $tasks, $busy, $now, $windowEnd, $zone);
            if ($proposal['items'] === []) {
                throw new AiPlannerException('AI 没有生成可用的时间安排，请稍后再试。', 502);
            }

            $db->prepare(
                'UPDATE ai_plans SET status = "ready", proposal_json = ?, input_tokens = ?, output_tokens = ? WHERE id = ?'
            )->execute([
                json_encode($proposal, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                $response['inputTokens'],
                $response['outputTokens'],
                $planId,
            ]);

            return $this->planView(
                $planId,
                $model,
                $proposal,
                max(0, $dailyLimit - $usedToday - 1),
                $expiresAt,
            );
        } catch (Throwable $error) {
            $message = $this->truncate($error->getMessage(), 500);
            $db->prepare('UPDATE ai_plans SET status = "failed", error_message = ? WHERE id = ?')->execute([$message, $planId]);
            if ($error instanceof AiPlannerException) {
                throw $error;
            }
            throw new AiPlannerException('AI 暂时无法生成安排，请稍后再试。', 502);
        }
    }

    public function apply(PDO $db, int $userId, int $planId, string $timezone): array
    {
        $statement = $db->prepare('SELECT * FROM ai_plans WHERE id = ? AND user_id = ? LIMIT 1');
        $statement->execute([$planId, $userId]);
        $plan = $statement->fetch();
        if (!$plan || $plan['status'] !== 'ready') {
            throw new AiPlannerException('这份 AI 建议已经失效，请重新生成。', 409);
        }

        $nowUtc = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $expiresAt = new DateTimeImmutable((string) $plan['expires_at'], new DateTimeZone('UTC'));
        if ($expiresAt <= $nowUtc) {
            $db->prepare('UPDATE ai_plans SET status = "expired" WHERE id = ?')->execute([$planId]);
            throw new AiPlannerException('这份 AI 建议已超过 30 分钟，请重新生成。', 409);
        }

        try {
            $proposal = json_decode((string) $plan['proposal_json'], true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AiPlannerException('AI 建议数据损坏，请重新生成。', 500);
        }
        if (!is_array($proposal) || !is_array($proposal['items'] ?? null)) {
            throw new AiPlannerException('AI 建议数据格式不正确，请重新生成。', 500);
        }

        $zone = $this->timezone($timezone);
        $appliedTaskIds = [];
        $db->beginTransaction();
        try {
            $taskStatement = $db->prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? FOR UPDATE');
            $conflictStatement = $db->prepare(
                'SELECT id FROM tasks
                 WHERE user_id = ? AND id != ? AND status NOT IN ("completed", "cancelled")
                   AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < ? AND end_at > ?
                 LIMIT 1'
            );
            $update = $db->prepare(
                'UPDATE tasks SET status = "planned", priority = ?, start_at = ?, end_at = ?, reminder_at = ?, reminder_sent_at = NULL
                 WHERE id = ? AND user_id = ?'
            );

            foreach ($proposal['items'] as $item) {
                $taskId = (int) ($item['taskId'] ?? 0);
                $taskStatement->execute([$taskId, $userId]);
                $task = $taskStatement->fetch();
                if (!$task || $task['status'] !== 'inbox' || $task['start_at'] !== null) {
                    throw new AiPlannerException('任务状态已经变化，请重新生成 AI 安排。', 409);
                }

                $start = $this->parseStoredDate((string) ($item['startAt'] ?? ''), $zone);
                $end = $start->add(new DateInterval('PT' . max(1, (int) $task['estimated_minutes']) . 'M'));
                $startUtc = $start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                $endUtc = $end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                $conflictStatement->execute([$userId, $taskId, $endUtc, $startUtc]);
                if ($conflictStatement->fetchColumn()) {
                    throw new AiPlannerException('日程在预览后发生了变化，请重新生成 AI 安排。', 409);
                }

                $reminderMinutes = $task['reminder_minutes'] === null ? null : (int) $task['reminder_minutes'];
                $reminderAt = $reminderMinutes === null
                    ? null
                    : (new DateTimeImmutable($startUtc, new DateTimeZone('UTC')))
                        ->sub(new DateInterval('PT' . max(0, $reminderMinutes) . 'M'))
                        ->format('Y-m-d H:i:s');
                $update->execute([
                    $this->priority((string) ($item['priority'] ?? 'medium')),
                    $startUtc,
                    $endUtc,
                    $reminderAt,
                    $taskId,
                    $userId,
                ]);
                $appliedTaskIds[] = $taskId;
            }

            $db->prepare('UPDATE ai_plans SET status = "applied", applied_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?')
                ->execute([$planId, $userId]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            if ($error instanceof AiPlannerException) {
                throw $error;
            }
            throw new AiPlannerException('AI 安排保存失败，请稍后再试。', 500);
        }

        return $appliedTaskIds;
    }

    private function requestPlan(
        string $apiKey,
        string $model,
        string $timezone,
        DateTimeImmutable $now,
        DateTimeImmutable $windowEnd,
        array $tasks,
        array $busy,
    ): array {
        $effort = (string) Config::get('OPENAI_REASONING_EFFORT', 'low');
        if (!in_array($effort, ['none', 'low', 'medium', 'high', 'xhigh'], true)) {
            $effort = 'low';
        }

        $context = [
            'timezone' => $timezone,
            'current_time' => $now->format(DATE_ATOM),
            'planning_window' => [
                'start_date' => $now->format('Y-m-d'),
                'end_date' => $windowEnd->modify('-1 day')->format('Y-m-d'),
                'daily_start' => substr(self::DAY_START, 0, 5),
                'daily_end' => substr(self::DAY_END, 0, 5),
            ],
            'tasks' => array_map(fn (array $task): array => [
                'id' => (int) $task['id'],
                'title' => $task['title'],
                'notes' => $this->truncate((string) ($task['notes'] ?? ''), 500),
                'priority' => $task['priority'],
                'duration_minutes' => (int) $task['estimated_minutes'],
                'due_at' => $task['due_local'],
                'project' => $task['project_title'] ?? null,
                'category' => $task['category_name'] ?? null,
            ], $tasks),
            'busy_blocks' => $busy,
        ];

        $request = [
            'model' => $model,
            'store' => false,
            'reasoning' => ['effort' => $effort],
            'max_output_tokens' => 4000,
            'input' => [
                [
                    'role' => 'developer',
                    'content' => [[
                        'type' => 'input_text',
                        'text' => '你是人生看板的日程规划助手。只安排给出的未安排任务，不创建任务，不修改标题。优先考虑截止时间、优先级、精力切换和合理缓冲。所有任务必须完整放进 08:00 至 21:00，不能进入过去、不能重叠现有日程，也不能互相重叠。开始时间使用 15 分钟刻度。无法合理安排的任务放入 skipped。输出简洁中文理由。',
                    ]],
                ],
                [
                    'role' => 'user',
                    'content' => [[
                        'type' => 'input_text',
                        'text' => json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                    ]],
                ],
            ],
            'text' => [
                'format' => [
                    'type' => 'json_schema',
                    'name' => 'life_schedule_proposal',
                    'strict' => true,
                    'schema' => [
                        'type' => 'object',
                        'additionalProperties' => false,
                        'properties' => [
                            'summary' => ['type' => 'string'],
                            'items' => [
                                'type' => 'array',
                                'items' => [
                                    'type' => 'object',
                                    'additionalProperties' => false,
                                    'properties' => [
                                        'task_id' => ['type' => 'integer'],
                                        'start_at' => ['type' => 'string'],
                                        'priority' => ['type' => 'string', 'enum' => ['low', 'medium', 'high']],
                                        'reason' => ['type' => 'string'],
                                    ],
                                    'required' => ['task_id', 'start_at', 'priority', 'reason'],
                                ],
                            ],
                            'skipped' => [
                                'type' => 'array',
                                'items' => [
                                    'type' => 'object',
                                    'additionalProperties' => false,
                                    'properties' => [
                                        'task_id' => ['type' => 'integer'],
                                        'reason' => ['type' => 'string'],
                                    ],
                                    'required' => ['task_id', 'reason'],
                                ],
                            ],
                        ],
                        'required' => ['summary', 'items', 'skipped'],
                    ],
                ],
            ],
        ];

        if (!function_exists('curl_init')) {
            throw new AiPlannerException('服务器尚未启用 PHP cURL 扩展。', 503);
        }
        $endpoint = rtrim((string) Config::get('OPENAI_BASE_URL', 'https://api.openai.com/v1'), '/') . '/responses';
        $curl = curl_init($endpoint);
        if ($curl === false) {
            throw new AiPlannerException('无法初始化 AI 网络连接。', 502);
        }
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($request, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => max(30, min(180, (int) Config::get('OPENAI_TIMEOUT_SECONDS', '90'))),
        ]);
        $raw = curl_exec($curl);
        $curlError = curl_error($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if ($raw === false) {
            throw new AiPlannerException('连接 OpenAI 超时或失败：' . $curlError, 502);
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AiPlannerException('OpenAI 返回了无法识别的数据。', 502);
        }
        if ($status < 200 || $status >= 300) {
            $apiMessage = trim((string) ($decoded['error']['message'] ?? ''));
            error_log('OpenAI API error: ' . $raw);
            $message = match ($status) {
                401 => 'OpenAI API 密钥无效，请检查服务器配置。',
                429 => 'OpenAI 账户余额不足或请求过于频繁。',
                default => $apiMessage !== '' ? 'OpenAI 暂时无法处理请求：' . $this->truncate($apiMessage, 180) : 'OpenAI 暂时无法处理请求。',
            };
            throw new AiPlannerException($message, $status === 429 ? 429 : 502);
        }

        $outputText = '';
        foreach ((array) ($decoded['output'] ?? []) as $output) {
            if (($output['type'] ?? null) !== 'message') {
                continue;
            }
            foreach ((array) ($output['content'] ?? []) as $content) {
                if (($content['type'] ?? null) === 'output_text') {
                    $outputText .= (string) ($content['text'] ?? '');
                }
            }
        }
        if ($outputText === '') {
            throw new AiPlannerException('OpenAI 没有返回日程建议，请稍后再试。', 502);
        }
        try {
            $proposal = json_decode($outputText, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new AiPlannerException('OpenAI 返回的日程建议格式不正确。', 502);
        }
        if (!is_array($proposal)) {
            throw new AiPlannerException('OpenAI 返回的日程建议格式不正确。', 502);
        }

        return [
            'proposal' => $proposal,
            'inputTokens' => max(0, (int) ($decoded['usage']['input_tokens'] ?? 0)),
            'outputTokens' => max(0, (int) ($decoded['usage']['output_tokens'] ?? 0)),
        ];
    }

    private function validateProposal(
        array $proposal,
        array $tasks,
        array $busy,
        DateTimeImmutable $now,
        DateTimeImmutable $windowEnd,
        DateTimeZone $zone,
    ): array {
        $taskMap = [];
        foreach ($tasks as $task) {
            $taskMap[(int) $task['id']] = $task;
        }
        $intervals = [];
        foreach ($busy as $block) {
            $intervals[] = [
                new DateTimeImmutable((string) $block['start_at'], $zone),
                new DateTimeImmutable((string) $block['end_at'], $zone),
            ];
        }

        $items = [];
        $skipped = [];
        $seen = [];
        foreach ((array) ($proposal['items'] ?? []) as $item) {
            $taskId = (int) ($item['task_id'] ?? 0);
            if (isset($seen[$taskId]) || !isset($taskMap[$taskId])) {
                continue;
            }
            $seen[$taskId] = true;
            $task = $taskMap[$taskId];
            try {
                $start = $this->parseModelDate((string) ($item['start_at'] ?? ''), $zone);
            } catch (AiPlannerException $error) {
                $skipped[] = ['taskId' => $taskId, 'title' => $task['title'], 'reason' => $error->getMessage()];
                continue;
            }
            $end = $start->add(new DateInterval('PT' . max(1, (int) $task['estimated_minutes']) . 'M'));
            $dayStart = $start->setTime(8, 0);
            $dayEnd = $start->setTime(21, 0);
            $invalidWindow = $start < $now || $start >= $windowEnd || $end > $windowEnd || $start < $dayStart || $end > $dayEnd;
            $conflict = false;
            foreach ($intervals as [$busyStart, $busyEnd]) {
                if ($start < $busyEnd && $end > $busyStart) {
                    $conflict = true;
                    break;
                }
            }
            if ($invalidWindow || $conflict) {
                $skipped[] = [
                    'taskId' => $taskId,
                    'title' => $task['title'],
                    'reason' => $conflict ? '建议时间与现有日程冲突。' : '建议时间不在可安排范围内。',
                ];
                continue;
            }

            $intervals[] = [$start, $end];
            $items[] = [
                'taskId' => $taskId,
                'title' => $task['title'],
                'startAt' => $start->format(DATE_ATOM),
                'endAt' => $end->format(DATE_ATOM),
                'duration' => (int) $task['estimated_minutes'],
                'priority' => $this->priority((string) ($item['priority'] ?? $task['priority'])),
                'reason' => $this->truncate(trim((string) ($item['reason'] ?? '根据截止时间和优先级安排。')), 240),
            ];
        }

        foreach ((array) ($proposal['skipped'] ?? []) as $item) {
            $taskId = (int) ($item['task_id'] ?? 0);
            if (isset($seen[$taskId]) || !isset($taskMap[$taskId])) {
                continue;
            }
            $seen[$taskId] = true;
            $skipped[] = [
                'taskId' => $taskId,
                'title' => $taskMap[$taskId]['title'],
                'reason' => $this->truncate(trim((string) ($item['reason'] ?? '暂时没有合适的时间。')), 240),
            ];
        }

        usort($items, static fn (array $left, array $right): int => strcmp($left['startAt'], $right['startAt']));
        return [
            'summary' => $this->truncate(trim((string) ($proposal['summary'] ?? '已经按优先级整理了接下来一周。')), 300),
            'items' => $items,
            'skipped' => $skipped,
        ];
    }

    private function sourceTasks(PDO $db, int $userId, string $timezone): array
    {
        $statement = $db->prepare(
            'SELECT tasks.*, projects.title AS project_title, categories.name AS category_name
             FROM tasks
             LEFT JOIN projects ON projects.id = tasks.project_id
             LEFT JOIN categories ON categories.id = tasks.category_id
             WHERE tasks.user_id = ? AND tasks.status = "inbox" AND tasks.start_at IS NULL
             ORDER BY FIELD(tasks.priority, "high", "medium", "low"), tasks.due_at IS NULL, tasks.due_at, tasks.created_at
             LIMIT ' . self::MAX_SOURCE_TASKS
        );
        $statement->execute([$userId]);
        $zone = $this->timezone($timezone);
        return array_map(static function (array $task) use ($zone): array {
            $task['due_local'] = $task['due_at']
                ? (new DateTimeImmutable((string) $task['due_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM)
                : null;
            return $task;
        }, $statement->fetchAll());
    }

    private function busyBlocks(
        PDO $db,
        int $userId,
        DateTimeImmutable $windowStart,
        DateTimeImmutable $windowEnd,
        string $timezone,
    ): array {
        $startUtc = $windowStart->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $endUtc = $windowEnd->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $statement = $db->prepare(
            'SELECT title, start_at, end_at FROM tasks
             WHERE user_id = ? AND status NOT IN ("completed", "cancelled")
               AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < ? AND end_at > ?
             ORDER BY start_at'
        );
        $statement->execute([$userId, $endUtc, $startUtc]);
        $zone = $this->timezone($timezone);
        return array_map(static fn (array $row): array => [
            'title' => $row['title'],
            'start_at' => (new DateTimeImmutable((string) $row['start_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
            'end_at' => (new DateTimeImmutable((string) $row['end_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
        ], $statement->fetchAll());
    }

    private function usageToday(PDO $db, int $userId, DateTimeImmutable $today): int
    {
        $start = $today->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $end = $today->modify('+1 day')->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $statement = $db->prepare('SELECT COUNT(*) FROM ai_plans WHERE user_id = ? AND created_at >= ? AND created_at < ?');
        $statement->execute([$userId, $start, $end]);
        return (int) $statement->fetchColumn();
    }

    private function parseModelDate(string $value, DateTimeZone $zone): DateTimeImmutable
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/', $value)) {
            throw new AiPlannerException('AI 返回的开始时间格式不正确。', 502);
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $value, $zone);
        if ($date === false || $date->format('Y-m-d\TH:i:s') !== $value) {
            throw new AiPlannerException('AI 返回的开始时间无法识别。', 502);
        }
        if ((int) $date->format('i') % 15 !== 0) {
            throw new AiPlannerException('AI 返回的开始时间不在 15 分钟刻度上。', 502);
        }
        return $date;
    }

    private function parseStoredDate(string $value, DateTimeZone $zone): DateTimeImmutable
    {
        try {
            return (new DateTimeImmutable($value))->setTimezone($zone);
        } catch (Throwable) {
            throw new AiPlannerException('AI 建议中的时间无法识别。', 500);
        }
    }

    private function priority(string $value): string
    {
        return in_array($value, ['low', 'medium', 'high'], true) ? $value : 'medium';
    }

    private function truncate(string $value, int $length): string
    {
        return function_exists('mb_substr') ? mb_substr($value, 0, $length) : substr($value, 0, $length);
    }

    private function timezone(string $timezone): DateTimeZone
    {
        try {
            return new DateTimeZone($timezone);
        } catch (Throwable) {
            return new DateTimeZone('Europe/Berlin');
        }
    }

    private function planView(
        int $planId,
        string $model,
        array $proposal,
        int $remainingUses,
        DateTimeImmutable $expiresAt,
    ): array {
        return [
            'id' => $planId,
            'model' => $model,
            'summary' => $proposal['summary'],
            'items' => $proposal['items'],
            'skipped' => $proposal['skipped'],
            'remainingUses' => $remainingUses,
            'expiresAt' => $expiresAt->format(DATE_ATOM),
        ];
    }
}
