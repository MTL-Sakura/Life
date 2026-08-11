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
    private const MAX_SOURCE_TASKS = 20;

    public function generate(PDO $db, int $userId, string $timezone, string $scope = 'today', array $reviewContext = [], array $runtimeContext = []): array
    {
        $apiKey = Config::get('OPENAI_API_KEY');
        if ($apiKey === null || trim($apiKey) === '') {
            throw new AiPlannerException('AI 服务尚未配置，请先填写 OpenAI API 密钥。', 503);
        }

        $zone = $this->timezone($timezone);
        $now = new DateTimeImmutable('now', $zone);
        $today = $now->setTime(0, 0);
        $scope = in_array($scope, ['today', 'next_week', 'rebalance'], true) ? $scope : 'today';
        if ($scope === 'next_week') {
            $daysUntilMonday = 8 - (int) $today->format('N');
            $windowStart = $today->modify("+{$daysUntilMonday} days");
            $windowEnd = $windowStart->modify('+7 days');
        } else {
            $windowStart = $today;
            $windowEnd = $today->modify('+1 day');
        }
        $preferences = $this->preferences($db, $userId);
        $runtimeContext = $scope === 'rebalance' ? $this->rebalanceContext($runtimeContext, $preferences) : [];
        if ($scope === 'rebalance') {
            $preferences['planningEndTime'] = min($preferences['planningEndTime'], $runtimeContext['latestEnd']);
        }
        $dailyLimit = max(1, min(10, (int) Config::get('OPENAI_DAILY_LIMIT', '2')));
        $usedToday = $this->usageToday($db, $userId, $today);
        if ($usedToday >= $dailyLimit) {
            throw new AiPlannerException("今天的 AI 安排次数已经用完了，明天可以再使用 {$dailyLimit} 次。", 429);
        }

        $tasks = $this->sourceTasks(
            $db,
            $userId,
            $timezone,
            $windowStart,
            $windowEnd,
            $scope === 'next_week',
            $scope !== 'rebalance',
        );
        if ($tasks === []) {
            throw new AiPlannerException($scope === 'next_week' ? '目前没有需要放进下周的灵活任务。' : ($scope === 'rebalance' ? '余下今天没有可以重排的任务。' : '今天没有需要整理的任务。'));
        }

        $sourceTaskIds = array_map(static fn (array $task): int => (int) $task['id'], $tasks);
        $busy = $this->busyBlocks($db, $userId, $windowStart, $windowEnd, $timezone, $sourceTaskIds, $preferences);
        $model = trim((string) Config::get('OPENAI_MODEL', 'gpt-5.4-mini'));
        $expiresAt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 minutes');

        $insert = $db->prepare(
            'INSERT INTO ai_plans (user_id, status, model, source_task_ids, target_start_date, target_end_date, expires_at)
             VALUES (?, "generating", ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $userId,
            $model,
            json_encode($sourceTaskIds, JSON_THROW_ON_ERROR),
            $windowStart->format('Y-m-d'),
            $windowEnd->modify('-1 day')->format('Y-m-d'),
            $expiresAt->format('Y-m-d H:i:s'),
        ]);
        $planId = (int) $db->lastInsertId();

        try {
            $response = $this->requestPlan($apiKey, $model, $timezone, $now, $windowStart, $windowEnd, $tasks, $busy, $preferences, $scope, $reviewContext, $runtimeContext);
            $earliestStart = $scope === 'next_week' ? $windowStart : $now;
            $proposal = $this->validateProposal($response['proposal'], $tasks, $busy, $earliestStart, $windowEnd, $zone, $preferences, $scope);
            $proposal['scope'] = $scope;
            $proposal['rebalance'] = $runtimeContext;
            if ($proposal['items'] === [] && !($scope === 'rebalance' && $proposal['skipped'] !== [])) {
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
                $scope,
                $windowStart,
                $windowEnd->modify('-1 day'),
                $runtimeContext,
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
        try {
            $sourceTaskIds = array_values(array_filter(array_map('intval', (array) json_decode((string) $plan['source_task_ids'], true, 512, JSON_THROW_ON_ERROR))));
        } catch (JsonException) {
            throw new AiPlannerException('AI 建议的任务列表已经损坏。', 500);
        }
        $sourcePlaceholders = $sourceTaskIds === [] ? '0' : implode(', ', array_fill(0, count($sourceTaskIds), '?'));
        $sourceTaskMap = array_fill_keys($sourceTaskIds, true);
        $proposalScope = (string) ($proposal['scope'] ?? 'today');
        $db->beginTransaction();
        try {
            $taskStatement = $db->prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? FOR UPDATE');
            $conflictStatement = $db->prepare(
                'SELECT id FROM tasks
                 WHERE user_id = ? AND id NOT IN (' . $sourcePlaceholders . ') AND status NOT IN ("completed", "cancelled")
                   AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < ? AND end_at > ?
                 LIMIT 1'
            );
            $blockConflictStatement = $db->prepare(
                'SELECT id FROM task_schedule_blocks
                 WHERE user_id = ? AND task_id NOT IN (' . $sourcePlaceholders . ') AND start_at < ? AND end_at > ? LIMIT 1'
            );
            $update = $db->prepare(
                'UPDATE tasks SET status = "planned", priority = ?, start_at = ?, end_at = ?, reminder_at = ?, reminder_sent_at = NULL
                 WHERE id = ? AND user_id = ?'
            );
            $insertBlock = $db->prepare(
                'INSERT INTO task_schedule_blocks (user_id, task_id, start_at, end_at, source, position)
                 VALUES (?, ?, ?, ?, "ai", ?)'
            );
            $deleteBlocks = $db->prepare('DELETE FROM task_schedule_blocks WHERE user_id = ? AND task_id = ?');
            $activeFocus = $db->prepare('SELECT id FROM focus_sessions WHERE task_id = ? AND status IN ("running", "paused") LIMIT 1 FOR UPDATE');

            foreach ($proposal['items'] as $item) {
                $taskId = (int) ($item['taskId'] ?? 0);
                if (!isset($sourceTaskMap[$taskId])) {
                    throw new AiPlannerException('AI 建议包含了不属于本次计划的任务。', 409);
                }
                $taskStatement->execute([$taskId, $userId]);
                $task = $taskStatement->fetch();
                if (!$task || in_array($task['status'], ['completed', 'cancelled'], true) || $task['schedule_mode'] === 'fixed') {
                    throw new AiPlannerException('任务状态已经变化，请重新生成 AI 安排。', 409);
                }
                $activeFocus->execute([$taskId]);
                if ($activeFocus->fetchColumn()) {
                    throw new AiPlannerException('有任务已经开始专注，请结束计时后重新生成安排。', 409);
                }

                $blocks = (array) ($item['blocks'] ?? []);
                if ($blocks === []) {
                    throw new AiPlannerException('AI 建议中的时间区块已经损坏。', 500);
                }
                $storedBlocks = [];
                foreach ($blocks as $block) {
                    $start = $this->parseStoredDate((string) ($block['startAt'] ?? ''), $zone);
                    $end = $this->parseStoredDate((string) ($block['endAt'] ?? ''), $zone);
                    $startUtc = $start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                    $endUtc = $end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                    $conflictStatement->execute([$userId, ...$sourceTaskIds, $endUtc, $startUtc]);
                    $blockConflictStatement->execute([$userId, ...$sourceTaskIds, $endUtc, $startUtc]);
                    if ($conflictStatement->fetchColumn() || $blockConflictStatement->fetchColumn()) {
                        throw new AiPlannerException('日程在预览后发生了变化，请重新生成 AI 安排。', 409);
                    }
                    $storedBlocks[] = [$startUtc, $endUtc];
                }
                $startUtc = $storedBlocks[0][0];
                $endUtc = $storedBlocks[count($storedBlocks) - 1][1];

                $reminderMinutes = $task['reminder_minutes'] === null ? null : (int) $task['reminder_minutes'];
                $reminderAt = $reminderMinutes === null
                    ? null
                    : (new DateTimeImmutable($startUtc, new DateTimeZone('UTC')))
                        ->sub(new DateInterval('PT' . max(0, $reminderMinutes) . 'M'))
                        ->format('Y-m-d H:i:s');
                $deleteBlocks->execute([$userId, $taskId]);
                $update->execute([
                    $this->priority((string) ($item['priority'] ?? 'medium')),
                    $startUtc,
                    $endUtc,
                    $reminderAt,
                    $taskId,
                    $userId,
                ]);
                foreach ($storedBlocks as $position => [$blockStart, $blockEnd]) {
                    $insertBlock->execute([$userId, $taskId, $blockStart, $blockEnd, $position]);
                }
                $appliedTaskIds[] = $taskId;
            }

            if ($proposalScope === 'rebalance') {
                $deferTask = $db->prepare(
                    'UPDATE tasks SET status = "inbox", start_at = NULL, end_at = NULL, schedule_mode = "flexible",
                     reminder_at = NULL, reminder_sent_at = NULL WHERE id = ? AND user_id = ?'
                );
                $skipOccurrence = $db->prepare(
                    'UPDATE tasks SET status = "cancelled", occurrence_state = "skipped", reminder_at = NULL,
                     reminder_sent_at = NULL WHERE id = ? AND user_id = ?'
                );
                $recordDecision = $db->prepare(
                    'INSERT INTO daily_task_decisions (user_id, task_id, local_date, action, failure_reason, task_title)
                     VALUES (?, ?, ?, ?, ?, ?)'
                );
                $today = (new DateTimeImmutable('now', $zone))->format('Y-m-d');
                $rebalance = is_array($proposal['rebalance'] ?? null) ? $proposal['rebalance'] : [];
                $failureReason = ($rebalance['mode'] ?? null) === 'low_energy' || (int) ($rebalance['currentEnergy'] ?? 3) <= 2
                    ? 'energy'
                    : 'changed';
                $appliedMap = array_fill_keys($appliedTaskIds, true);

                foreach ((array) ($proposal['skipped'] ?? []) as $item) {
                    $taskId = (int) ($item['taskId'] ?? 0);
                    if (($item['action'] ?? 'keep') === 'keep' || isset($appliedMap[$taskId]) || !isset($sourceTaskMap[$taskId])) {
                        continue;
                    }
                    $taskStatement->execute([$taskId, $userId]);
                    $task = $taskStatement->fetch();
                    if (!$task || in_array($task['status'], ['completed', 'cancelled'], true) || $task['schedule_mode'] === 'fixed') {
                        throw new AiPlannerException('任务状态已经变化，请重新生成 AI 安排。', 409);
                    }
                    $activeFocus->execute([$taskId]);
                    if ($activeFocus->fetchColumn()) {
                        throw new AiPlannerException('有任务已经开始专注，请结束计时后重新生成安排。', 409);
                    }
                    $deleteBlocks->execute([$userId, $taskId]);
                    $recurring = !empty($task['recurrence_rule']);
                    if ($recurring) {
                        $skipOccurrence->execute([$taskId, $userId]);
                    } else {
                        $deferTask->execute([$taskId, $userId]);
                    }
                    $recordDecision->execute([
                        $userId,
                        $taskId,
                        $today,
                        $recurring ? 'drop' : 'later',
                        $failureReason,
                        (string) $task['title'],
                    ]);
                }
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
        DateTimeImmutable $windowStart,
        DateTimeImmutable $windowEnd,
        array $tasks,
        array $busy,
        array $preferences,
        string $scope,
        array $reviewContext,
        array $runtimeContext,
    ): array {
        $effort = (string) Config::get('OPENAI_REASONING_EFFORT', 'low');
        if (!in_array($effort, ['none', 'low', 'medium', 'high', 'xhigh'], true)) {
            $effort = 'low';
        }

        $context = [
            'timezone' => $timezone,
            'current_time' => $now->format(DATE_ATOM),
            'planning_window' => [
                'start_date' => $windowStart->format('Y-m-d'),
                'end_date' => $windowEnd->modify('-1 day')->format('Y-m-d'),
                'daily_start' => $preferences['planningStartTime'],
                'daily_end' => $preferences['planningEndTime'],
                'lunch' => [$preferences['lunchStartTime'], $preferences['lunchEndTime']],
                'dinner' => [$preferences['dinnerStartTime'], $preferences['dinnerEndTime']],
                'buffer_minutes' => $preferences['planningBufferMinutes'],
            ],
            'tasks' => array_map(fn (array $task): array => [
                'id' => (int) $task['id'],
                'title' => $task['title'],
                'notes' => $this->truncate((string) ($task['notes'] ?? ''), 500),
                'priority' => $task['priority'],
                'duration_minutes' => (int) $task['estimated_minutes'],
                'focus' => (bool) $task['is_focus'],
                'schedule_mode' => $task['schedule_mode'],
                'current_start_at' => $task['start_local'],
                'current_end_at' => $task['end_local'],
                'allowed_window' => $task['schedule_mode'] === 'window' ? [$task['window_start_local'], $task['window_end_local']] : null,
                'due_at' => $task['due_local'],
                'project' => $task['project_title'] ?? null,
                'category' => $task['category_name'] ?? null,
            ], $tasks),
            'busy_blocks' => $busy,
            'weekly_review' => $scope === 'next_week' ? $reviewContext : null,
            'rebalance' => $scope === 'rebalance' ? $runtimeContext : null,
        ];

        $developerPrompt = match ($scope) {
            'next_week' => '你是人生看板的周回顾与下周安排助手。先根据 weekly_review 找出真实节奏，尤其参考 estimateAccuracy、calibrationActualMinutes、failureReasons、rescueStarts、rescueContinued、rescueReasons、精力和迁移数据，给出最多3条温和、具体、可执行的 adjustments；当实际耗时明显高于预计时建议减少负荷或拆分，当某个失败原因或启动卡点反复出现时建议换时段或降低启动难度。再安排给出的灵活任务。不要追求塞满一周，不创建、不删除、不改标题，也不要擅自更改任务预计时长。必须遵守 planning_window、每天的午晚餐、任务时间窗、固定日程和缓冲；开始时间使用15分钟刻度。专注任务超过90分钟时拆成不超过90分钟的多个区块，区块总时长等于任务时长，区块之间至少间隔30分钟。无法合理安排的任务放入 skipped。输出简洁中文。',
            'rebalance' => '你是人生看板的余下今天重排助手。只处理当前时间之后，并参考 rebalance.currentEnergy、mode、latestEnd 和 dailyFocusTaskId。normal 模式保留可现实完成的重点；low_energy 模式主动减负，只留下今日重点和少量低启动成本任务。不要追回已经错过的全部计划，不创建、不删除、不改标题、不缩短任务预计时长。固定安排、午晚餐、任务时间窗、最晚结束时间和缓冲必须保留；开始时间使用15分钟刻度。今日重点应优先保留，除非时间上确实无法完成。专注任务超过90分钟时拆成不超过90分钟的区块，区块总时长必须等于任务时长，区块之间至少休息30分钟。今天放不下或不适合当前精力的任务放入 skipped。summary 要明确今天保留了什么、放下了什么，输出温和简洁中文。',
            default => '你是人生看板的今日整理助手。给出最多3条简短的执行 adjustments，并只调整给出的任务，不创建、不删除、不改标题。必须遵守 planning_window、午晚餐、任务时间窗、现有日程和缓冲；开始时间使用15分钟刻度。专注任务超过90分钟时拆成不超过90分钟的多个区块，区块总时长等于任务时长，区块之间至少间隔30分钟。无法合理安排的任务放入 skipped，并只建议延期或跳过。输出简洁中文理由。',
        };

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
                        'text' => $developerPrompt,
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
                            'adjustments' => [
                                'type' => 'array',
                                'maxItems' => 3,
                                'items' => ['type' => 'string'],
                            ],
                            'items' => [
                                'type' => 'array',
                                'items' => [
                                    'type' => 'object',
                                    'additionalProperties' => false,
                                    'properties' => [
                                        'task_id' => ['type' => 'integer'],
                                        'blocks' => [
                                            'type' => 'array',
                                            'items' => [
                                                'type' => 'object',
                                                'additionalProperties' => false,
                                                'properties' => [
                                                    'start_at' => ['type' => 'string'],
                                                    'duration_minutes' => ['type' => 'integer'],
                                                ],
                                                'required' => ['start_at', 'duration_minutes'],
                                            ],
                                        ],
                                        'priority' => ['type' => 'string', 'enum' => ['low', 'medium', 'high']],
                                        'reason' => ['type' => 'string'],
                                    ],
                                    'required' => ['task_id', 'blocks', 'priority', 'reason'],
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
                        'required' => ['summary', 'adjustments', 'items', 'skipped'],
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
        array $preferences,
        string $scope,
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
            $proposedBlocks = (array) ($item['blocks'] ?? []);
            $validatedBlocks = [];
            $blockIntervals = [];
            $totalMinutes = 0;
            $invalidReason = '';
            foreach ($proposedBlocks as $position => $block) {
                try {
                    $start = $this->parseModelDate((string) ($block['start_at'] ?? ''), $zone);
                } catch (AiPlannerException $error) {
                    $invalidReason = $error->getMessage();
                    break;
                }
                $minutes = (int) ($block['duration_minutes'] ?? 0);
                if ($minutes < 1 || ((bool) $task['is_focus'] && (int) $task['estimated_minutes'] > 90 && $minutes > 90)) {
                    $invalidReason = '专注区块长度不符合规则。';
                    break;
                }
                $end = $start->add(new DateInterval('PT' . $minutes . 'M'));
                [$startHour, $startMinute] = array_map('intval', explode(':', $preferences['planningStartTime']));
                [$endHour, $endMinute] = array_map('intval', explode(':', $preferences['planningEndTime']));
                $dayStart = $start->setTime($startHour, $startMinute);
                $dayEnd = $start->setTime($endHour, $endMinute);
                if ($start < $now || $start >= $windowEnd || $end > $windowEnd || $start < $dayStart || $end > $dayEnd) {
                    $invalidReason = '建议时间不在今天的可安排范围内。';
                    break;
                }
                if ($task['schedule_mode'] === 'window' && !$this->insideTaskWindow($start, $end, $task)) {
                    $invalidReason = '建议时间超出了任务自己的时间窗。';
                    break;
                }
                foreach ([...$intervals, ...$blockIntervals] as [$busyStart, $busyEnd]) {
                    $buffer = new DateInterval('PT' . max(0, (int) $preferences['planningBufferMinutes']) . 'M');
                    if ($start < $busyEnd->add($buffer) && $end->add($buffer) > $busyStart) {
                        $invalidReason = '建议时间与现有日程或缓冲时间冲突。';
                        break 2;
                    }
                }
                if ($position > 0) {
                    $previousEnd = $blockIntervals[$position - 1][1];
                    if ($start->getTimestamp() - $previousEnd->getTimestamp() < 1800) {
                        $invalidReason = '拆分的专注区块之间至少需要休息 30 分钟。';
                        break;
                    }
                }
                $totalMinutes += $minutes;
                $blockIntervals[] = [$start, $end];
                $validatedBlocks[] = [
                    'startAt' => $start->format(DATE_ATOM),
                    'endAt' => $end->format(DATE_ATOM),
                    'duration' => $minutes,
                ];
            }
            if ($proposedBlocks === [] || $totalMinutes !== (int) $task['estimated_minutes']) {
                $invalidReason = $invalidReason ?: '建议区块的总时长与任务时长不一致。';
            }
            if (!(bool) $task['is_focus'] && count($validatedBlocks) > 1) {
                $invalidReason = '非专注任务不需要拆分。';
            }
            if ($invalidReason !== '') {
                $skipped[] = [
                    'taskId' => $taskId,
                    'title' => $task['title'],
                    'reason' => $invalidReason,
                    'action' => $this->skippedAction($task, $scope),
                ];
                continue;
            }

            array_push($intervals, ...$blockIntervals);
            $firstBlock = $validatedBlocks[0];
            $lastBlock = $validatedBlocks[count($validatedBlocks) - 1];
            $items[] = [
                'taskId' => $taskId,
                'title' => $task['title'],
                'startAt' => $firstBlock['startAt'],
                'endAt' => $lastBlock['endAt'],
                'blocks' => $validatedBlocks,
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
                'action' => $this->skippedAction($taskMap[$taskId], $scope),
            ];
        }

        foreach ($taskMap as $taskId => $task) {
            if (isset($seen[$taskId])) {
                continue;
            }
            $skipped[] = [
                'taskId' => $taskId,
                'title' => $task['title'],
                'reason' => $scope === 'rebalance' ? '这项任务没有进入余下今天的可执行方案。' : '暂时没有合适的时间。',
                'action' => $this->skippedAction($task, $scope),
            ];
        }

        usort($items, static fn (array $left, array $right): int => strcmp($left['startAt'], $right['startAt']));
        $adjustments = [];
        foreach (array_slice((array) ($proposal['adjustments'] ?? []), 0, 3) as $adjustment) {
            $text = $this->truncate(trim((string) $adjustment), 180);
            if ($text !== '') {
                $adjustments[] = $text;
            }
        }
        return [
            'summary' => $this->truncate(trim((string) ($proposal['summary'] ?? ($scope === 'next_week' ? '已经根据本周节奏准备了下周草案。' : ($scope === 'rebalance' ? '已经重新整理了余下今天。' : '已经按优先级整理了今天。')))), 300),
            'adjustments' => $adjustments,
            'items' => $items,
            'skipped' => $skipped,
        ];
    }

    private function sourceTasks(
        PDO $db,
        int $userId,
        string $timezone,
        DateTimeImmutable $windowStart,
        DateTimeImmutable $windowEnd,
        bool $includeUndatedInbox = false,
        bool $includeInbox = true,
    ): array
    {
        $startUtc = $windowStart->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $endUtc = $windowEnd->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $nearDueUtc = $windowEnd->modify('+2 days')->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $statement = $db->prepare(
            'SELECT tasks.*, projects.title AS project_title, categories.name AS category_name
             FROM tasks
             LEFT JOIN projects ON projects.id = tasks.project_id
             LEFT JOIN categories ON categories.id = tasks.category_id
             WHERE tasks.user_id = ? AND tasks.status NOT IN ("completed", "cancelled") AND tasks.schedule_mode != "fixed"
               AND NOT EXISTS (SELECT 1 FROM focus_sessions WHERE focus_sessions.task_id = tasks.id AND focus_sessions.status IN ("running", "paused"))
               AND ((tasks.start_at >= ? AND tasks.start_at < ?)
                    OR (? = 1 AND tasks.status = "inbox" AND tasks.start_at IS NULL
                        AND (? = 1 OR (tasks.due_at IS NOT NULL AND tasks.due_at < ?))))
             ORDER BY FIELD(tasks.priority, "high", "medium", "low"), tasks.due_at IS NULL, tasks.due_at, tasks.created_at
             LIMIT ' . self::MAX_SOURCE_TASKS
        );
        $statement->execute([$userId, $startUtc, $endUtc, (int) $includeInbox, (int) $includeUndatedInbox, $nearDueUtc]);
        $zone = $this->timezone($timezone);
        return array_map(static function (array $task) use ($zone): array {
            $task['due_local'] = $task['due_at']
                ? (new DateTimeImmutable((string) $task['due_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM)
                : null;
            $task['start_local'] = $task['start_at']
                ? (new DateTimeImmutable((string) $task['start_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM)
                : null;
            $task['end_local'] = $task['end_at']
                ? (new DateTimeImmutable((string) $task['end_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM)
                : null;
            $task['window_start_local'] = $task['window_start'] ? substr((string) $task['window_start'], 0, 5) : null;
            $task['window_end_local'] = $task['window_end'] ? substr((string) $task['window_end'], 0, 5) : null;
            return $task;
        }, $statement->fetchAll());
    }

    private function busyBlocks(
        PDO $db,
        int $userId,
        DateTimeImmutable $windowStart,
        DateTimeImmutable $windowEnd,
        string $timezone,
        array $excludedTaskIds,
        array $preferences,
    ): array {
        $startUtc = $windowStart->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $endUtc = $windowEnd->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $notIn = $excludedTaskIds === [] ? '' : ' AND id NOT IN (' . implode(', ', array_fill(0, count($excludedTaskIds), '?')) . ')';
        $statement = $db->prepare(
            'SELECT title, start_at, end_at FROM tasks
             WHERE user_id = ? AND status NOT IN ("completed", "cancelled")
               AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < ? AND end_at > ?
               ' . $notIn . '
             ORDER BY start_at'
        );
        $statement->execute([$userId, $endUtc, $startUtc, ...$excludedTaskIds]);
        $zone = $this->timezone($timezone);
        $blocks = array_map(static fn (array $row): array => [
            'title' => $row['title'],
            'start_at' => (new DateTimeImmutable((string) $row['start_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
            'end_at' => (new DateTimeImmutable((string) $row['end_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
        ], $statement->fetchAll());
        $blockNotIn = $excludedTaskIds === [] ? '' : ' AND task_id NOT IN (' . implode(', ', array_fill(0, count($excludedTaskIds), '?')) . ')';
        $scheduleStatement = $db->prepare(
            'SELECT "专注区块" AS title, start_at, end_at FROM task_schedule_blocks
             WHERE user_id = ? AND start_at < ? AND end_at > ?' . $blockNotIn . ' ORDER BY start_at'
        );
        $scheduleStatement->execute([$userId, $endUtc, $startUtc, ...$excludedTaskIds]);
        foreach ($scheduleStatement->fetchAll() as $row) {
            $blocks[] = [
                'title' => $row['title'],
                'start_at' => (new DateTimeImmutable((string) $row['start_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
                'end_at' => (new DateTimeImmutable((string) $row['end_at'], new DateTimeZone('UTC')))->setTimezone($zone)->format(DATE_ATOM),
            ];
        }
        for ($day = $windowStart; $day < $windowEnd; $day = $day->modify('+1 day')) {
            foreach ([['午餐', 'lunchStartTime', 'lunchEndTime'], ['晚餐', 'dinnerStartTime', 'dinnerEndTime']] as [$title, $startKey, $endKey]) {
                $blocks[] = [
                    'title' => $title,
                    'start_at' => $day->format('Y-m-d') . 'T' . $preferences[$startKey] . ':00',
                    'end_at' => $day->format('Y-m-d') . 'T' . $preferences[$endKey] . ':00',
                ];
            }
        }
        return $blocks;
    }

    private function preferences(PDO $db, int $userId): array
    {
        $statement = $db->prepare(
            'SELECT planning_start_time, planning_end_time, lunch_start_time, lunch_end_time,
                    dinner_start_time, dinner_end_time, planning_buffer_minutes
             FROM user_settings WHERE user_id = ? LIMIT 1'
        );
        $statement->execute([$userId]);
        $row = $statement->fetch() ?: [];
        return [
            'planningStartTime' => substr((string) ($row['planning_start_time'] ?? '09:00:00'), 0, 5),
            'planningEndTime' => substr((string) ($row['planning_end_time'] ?? '23:30:00'), 0, 5),
            'lunchStartTime' => substr((string) ($row['lunch_start_time'] ?? '12:30:00'), 0, 5),
            'lunchEndTime' => substr((string) ($row['lunch_end_time'] ?? '13:30:00'), 0, 5),
            'dinnerStartTime' => substr((string) ($row['dinner_start_time'] ?? '18:00:00'), 0, 5),
            'dinnerEndTime' => substr((string) ($row['dinner_end_time'] ?? '19:00:00'), 0, 5),
            'planningBufferMinutes' => max(0, min(120, (int) ($row['planning_buffer_minutes'] ?? 15))),
        ];
    }

    private function rebalanceContext(array $context, array $preferences): array
    {
        $mode = ($context['mode'] ?? null) === 'low_energy' ? 'low_energy' : 'normal';
        $energy = max(1, min(5, (int) ($context['currentEnergy'] ?? 3)));
        $latestEnd = trim((string) ($context['latestEnd'] ?? $preferences['planningEndTime']));
        if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $latestEnd)) {
            $latestEnd = $preferences['planningEndTime'];
        }
        $dailyFocusTaskId = isset($context['dailyFocusTaskId']) && (int) $context['dailyFocusTaskId'] > 0
            ? (int) $context['dailyFocusTaskId']
            : null;
        return [
            'mode' => $mode,
            'currentEnergy' => $energy,
            'latestEnd' => $latestEnd,
            'dailyFocusTaskId' => $dailyFocusTaskId,
        ];
    }

    private function skippedAction(array $task, string $scope): string
    {
        if ($scope !== 'rebalance') {
            return 'keep';
        }
        return empty($task['recurrence_rule']) ? 'later' : 'skip';
    }

    private function insideTaskWindow(DateTimeImmutable $start, DateTimeImmutable $end, array $task): bool
    {
        if (empty($task['window_start_local']) || empty($task['window_end_local'])) {
            return false;
        }
        [$startHour, $startMinute] = array_map('intval', explode(':', (string) $task['window_start_local']));
        [$endHour, $endMinute] = array_map('intval', explode(':', (string) $task['window_end_local']));
        return $start >= $start->setTime($startHour, $startMinute)
            && $end <= $start->setTime($endHour, $endMinute);
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
        string $scope,
        DateTimeImmutable $targetStart,
        DateTimeImmutable $targetEnd,
        array $runtimeContext,
    ): array {
        return [
            'id' => $planId,
            'model' => $model,
            'summary' => $proposal['summary'],
            'adjustments' => $proposal['adjustments'] ?? [],
            'items' => $proposal['items'],
            'skipped' => $proposal['skipped'],
            'remainingUses' => $remainingUses,
            'expiresAt' => $expiresAt->format(DATE_ATOM),
            'scope' => $scope,
            'targetStartDate' => $targetStart->format('Y-m-d'),
            'targetEndDate' => $targetEnd->format('Y-m-d'),
            'mode' => $runtimeContext['mode'] ?? null,
            'currentEnergy' => $runtimeContext['currentEnergy'] ?? null,
            'latestEnd' => $runtimeContext['latestEnd'] ?? null,
        ];
    }
}
