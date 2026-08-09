<?php

declare(strict_types=1);

namespace Life;

use DateTimeImmutable;
use DateTimeZone;

final class Views
{
    public static function task(array $row, string $timezone, array $subtasks = [], ?array $focusSession = null, array $scheduleBlocks = []): array
    {
        $start = self::localDate($row['start_at'] ?? null, $timezone);
        $end = self::localDate($row['end_at'] ?? null, $timezone);
        $due = self::localDate($row['due_at'] ?? null, $timezone);
        $completed = self::localDate($row['completed_at'] ?? null, $timezone);

        return [
            'id' => (int) $row['id'],
            'title' => $row['title'],
            'notes' => $row['notes'] ?? '',
            'project' => $row['project_title'] ?? '未分类',
            'projectId' => isset($row['project_id']) ? (int) $row['project_id'] : null,
            'category' => $row['category_name'] ?? '收集箱',
            'categoryId' => isset($row['category_id']) ? (int) $row['category_id'] : null,
            'color' => $row['category_color'] ?? '#7a6b87',
            'priority' => $row['priority'],
            'start' => $start?->format('H:i'),
            'end' => $end?->format('H:i'),
            'startAt' => $start?->format(DATE_ATOM),
            'endAt' => $end?->format(DATE_ATOM),
            'dueAt' => $due?->format(DATE_ATOM),
            'due' => self::dueLabel($due, $timezone),
            'duration' => (int) $row['estimated_minutes'],
            'isFocus' => (bool) ($row['is_focus'] ?? false),
            'focusSession' => $focusSession === null ? null : [
                'id' => (int) $focusSession['id'],
                'status' => $focusSession['status'],
                'plannedSeconds' => (int) $focusSession['planned_seconds'],
                'elapsedSeconds' => (int) $focusSession['elapsed_seconds'],
                'startedAt' => self::localDate($focusSession['started_at'], $timezone)?->format(DATE_ATOM),
                'lastResumedAt' => self::localDate($focusSession['last_resumed_at'] ?? null, $timezone)?->format(DATE_ATOM),
                'endedAt' => self::localDate($focusSession['ended_at'] ?? null, $timezone)?->format(DATE_ATOM),
            ],
            'completed' => $row['status'] === 'completed',
            'unscheduled' => $row['status'] === 'inbox' || $row['start_at'] === null,
            'status' => $row['status'],
            'recurrenceRule' => $row['recurrence_rule'] ?? null,
            'recurrenceSourceTaskId' => isset($row['recurrence_source_task_id']) ? (int) $row['recurrence_source_task_id'] : null,
            'recurrenceSeriesId' => isset($row['recurrence_series_id']) ? (int) $row['recurrence_series_id'] : null,
            'recurrencePausedUntil' => $row['recurrence_paused_until'] ?? null,
            'skipped' => ($row['occurrence_state'] ?? 'normal') === 'skipped',
            'scheduleMode' => $row['schedule_mode'] ?? 'flexible',
            'windowStart' => isset($row['window_start']) ? substr((string) $row['window_start'], 0, 5) : null,
            'windowEnd' => isset($row['window_end']) ? substr((string) $row['window_end'], 0, 5) : null,
            'scheduleBlocks' => array_map(static function (array $block) use ($timezone): array {
                $blockStart = self::localDate($block['start_at'], $timezone);
                $blockEnd = self::localDate($block['end_at'], $timezone);
                return [
                    'id' => (int) $block['id'],
                    'startAt' => $blockStart?->format(DATE_ATOM),
                    'endAt' => $blockEnd?->format(DATE_ATOM),
                    'start' => $blockStart?->format('H:i'),
                    'end' => $blockEnd?->format('H:i'),
                    'source' => $block['source'],
                    'position' => (int) $block['position'],
                ];
            }, $scheduleBlocks),
            'reminderMinutes' => isset($row['reminder_minutes']) ? (int) $row['reminder_minutes'] : null,
            'completedAt' => $completed?->format(DATE_ATOM),
            'subtasks' => array_map(static fn (array $subtask): array => [
                'id' => (int) $subtask['id'],
                'title' => $subtask['title'],
                'completed' => (bool) $subtask['completed'],
                'position' => (int) $subtask['position'],
            ], $subtasks),
        ];
    }

    public static function project(array $row, array $stages): array
    {
        $totalTasks = (int) ($row['total_tasks'] ?? 0);
        $completedTasks = (int) ($row['completed_tasks'] ?? 0);
        $progress = $totalTasks > 0
            ? (int) round(($completedTasks / $totalTasks) * 100)
            : (int) $row['progress'];

        return [
            'id' => (int) $row['id'],
            'title' => $row['title'],
            'description' => $row['description'] ?? '',
            'area' => $row['area'],
            'color' => $row['color'],
            'status' => $row['status'],
            'progress' => $progress,
            'due' => $row['due_at'] ? (new DateTimeImmutable($row['due_at'], new DateTimeZone('UTC')))->format('Y-m-d') : '未设置',
            'dueAt' => $row['due_at'] ? (new DateTimeImmutable($row['due_at'], new DateTimeZone('UTC')))->format(DATE_ATOM) : null,
            'currentStage' => $row['current_stage'] ?? ($stages[0] ?? '确定下一步'),
            'completedTasks' => $completedTasks,
            'totalTasks' => $totalTasks,
            'stages' => $stages,
        ];
    }

    private static function localDate(?string $value, string $timezone): ?DateTimeImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone($timezone));
    }

    private static function dueLabel(?DateTimeImmutable $due, string $timezone): string
    {
        if ($due === null) {
            return '待安排';
        }

        $today = new DateTimeImmutable('today', new DateTimeZone($timezone));
        $date = $due->format('Y-m-d');
        if ($date === $today->format('Y-m-d')) {
            return '今天 ' . $due->format('H:i');
        }
        if ($date === $today->modify('+1 day')->format('Y-m-d')) {
            return '明天 ' . $due->format('H:i');
        }

        return $due->format('m 月 d 日 H:i');
    }
}
