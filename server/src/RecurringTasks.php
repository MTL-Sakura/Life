<?php

declare(strict_types=1);

namespace Life;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

/**
 * Recurring task generation.
 *
 * Every occurrence is a row in `tasks`; the next occurrence points back to the
 * previous one through `recurrence_source_task_id`. Times are stored in UTC but
 * a repeat must keep the user's local wall-clock time, so the next occurrence is
 * always calculated in the user's timezone (08:00 stays 08:00 across DST).
 */
final class RecurringTasks
{
    private const MOMENT_COLUMNS = ['start_at', 'due_at', 'end_at'];

    public static function frequency(?string $rule): ?string
    {
        $rule = strtoupper(trim((string) $rule));
        return match (true) {
            str_starts_with($rule, 'FREQ=DAILY') => 'daily',
            str_starts_with($rule, 'FREQ=WEEKLY') => 'weekly',
            str_starts_with($rule, 'FREQ=MONTHLY') => 'monthly',
            default => null,
        };
    }

    public static function monthDay(?string $rule): ?int
    {
        if (preg_match('/(?:^|;)BYMONTHDAY=(\d{1,2})(?:;|$)/i', (string) $rule, $match) !== 1) {
            return null;
        }
        $day = (int) $match[1];
        return $day >= 1 && $day <= 31 ? $day : null;
    }

    /**
     * Next occurrence of a local moment, keeping the wall-clock time.
     *
     * Monthly repeats keep their day of month; in shorter months they fall on
     * the last day and the rule remembers the intended day (BYMONTHDAY) so the
     * series returns to it afterwards instead of drifting.
     *
     * @return array{0: DateTimeImmutable, 1: string}|null
     */
    public static function nextLocal(DateTimeImmutable $local, string $rule): ?array
    {
        $frequency = self::frequency($rule);
        if ($frequency === 'daily') {
            return [self::shiftLocalDays($local, 1), $rule];
        }
        if ($frequency === 'weekly') {
            return [self::shiftLocalDays($local, 7), $rule];
        }
        if ($frequency !== 'monthly') {
            return null;
        }

        $anchorDay = self::monthDay($rule) ?? (int) $local->format('j');
        $year = (int) $local->format('Y');
        $month = (int) $local->format('n') + 1;
        if ($month > 12) {
            $month = 1;
            $year++;
        }
        $daysInMonth = (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month), $local->getTimezone()))->format('t');
        $day = min($anchorDay, $daysInMonth);
        $next = $local->setDate($year, $month, $day);
        if ($day < $anchorDay && self::monthDay($rule) === null) {
            $rule = rtrim($rule, ';') . ';BYMONTHDAY=' . $anchorDay;
        }
        return [$next, $rule];
    }

    public static function shiftLocalDays(DateTimeImmutable $local, int $days): DateTimeImmutable
    {
        return $local->modify(($days >= 0 ? '+' : '') . $days . ' days');
    }

    /**
     * Calculates the UTC start/end/due of the occurrence that follows $task.
     *
     * The primary moment (start, otherwise due, otherwise end) follows the
     * rule; the other moments move by the same number of local calendar days,
     * so a task that ends after midnight or is due a day later keeps its shape.
     *
     * @return array{start_at: ?string, end_at: ?string, due_at: ?string, rule: string}|null
     */
    public static function nextTimestamps(array $task, string $timezone): ?array
    {
        $rule = trim((string) ($task['recurrence_rule'] ?? ''));
        if (self::frequency($rule) === null) {
            return null;
        }
        $zone = new DateTimeZone($timezone);
        $primaryColumn = null;
        foreach (self::MOMENT_COLUMNS as $column) {
            if (!empty($task[$column])) {
                $primaryColumn = $column;
                break;
            }
        }
        if ($primaryColumn === null) {
            return null;
        }

        $primaryLocal = self::utcToLocal((string) $task[$primaryColumn], $zone);
        $next = self::nextLocal($primaryLocal, $rule);
        if ($next === null) {
            return null;
        }
        [$nextPrimary, $nextRule] = $next;
        $dayShift = self::calendarDaysBetween($primaryLocal, $nextPrimary);

        $result = ['start_at' => null, 'end_at' => null, 'due_at' => null, 'rule' => $nextRule];
        foreach (self::MOMENT_COLUMNS as $column) {
            if (empty($task[$column])) {
                continue;
            }
            $moment = $column === $primaryColumn
                ? $nextPrimary
                : self::shiftLocalDays(self::utcToLocal((string) $task[$column], $zone), $dayShift);
            $result[$column] = self::localToUtc($moment);
        }
        return $result;
    }

    /**
     * The timestamp the previous implementation produced: interval added in UTC.
     * Only used to recognise occurrences generated before the DST fix.
     */
    public static function legacyNextUtc(?string $value, ?string $rule): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $interval = match (self::frequency($rule)) {
            'daily' => new DateInterval('P1D'),
            'weekly' => new DateInterval('P1W'),
            'monthly' => new DateInterval('P1M'),
            default => null,
        };
        if ($interval === null) {
            return null;
        }
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->add($interval)->format('Y-m-d H:i:s');
    }

    public static function createNext(PDO $db, array $task, string $timezone): ?int
    {
        $existing = self::childId($db, (int) $task['id']);
        if ($existing !== null) {
            return $existing;
        }

        $next = self::nextTimestamps($task, $timezone);
        if ($next === null) {
            return null;
        }
        $reminderMinutes = isset($task['reminder_minutes']) ? (int) $task['reminder_minutes'] : null;
        $seriesId = self::nullableInt($task['recurrence_series_id'] ?? null);
        $pausedUntil = null;
        if ($seriesId !== null) {
            $series = $db->prepare('SELECT paused_until FROM task_series WHERE id = ? AND user_id = ? LIMIT 1');
            $series->execute([$seriesId, (int) $task['user_id']]);
            $value = $series->fetchColumn();
            $pausedUntil = is_string($value) && $value !== '' ? $value : null;
        }
        $nextMoment = $next['start_at'] ?? $next['due_at'] ?? $next['end_at'];
        $nextLocalDate = self::utcToLocal((string) $nextMoment, new DateTimeZone($timezone))->format('Y-m-d');
        $skipped = $pausedUntil !== null && $nextLocalDate < $pausedUntil;

        $statement = $db->prepare(
            'INSERT INTO tasks (user_id, project_id, category_id, title, notes, status, priority, start_at, end_at, due_at, estimated_minutes, is_focus, recurrence_rule, recurrence_source_task_id, recurrence_series_id, occurrence_state, schedule_mode, window_start, window_end, reminder_minutes, reminder_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        try {
            $statement->execute([
                (int) $task['user_id'],
                self::nullableInt($task['project_id'] ?? null),
                self::nullableInt($task['category_id'] ?? null),
                $task['title'],
                $task['notes'] ?? '',
                $skipped ? 'cancelled' : ($next['start_at'] === null ? 'inbox' : 'planned'),
                $task['priority'],
                $next['start_at'],
                $next['end_at'],
                $next['due_at'],
                (int) $task['estimated_minutes'],
                (int) ($task['is_focus'] ?? 0),
                $next['rule'],
                (int) $task['id'],
                $seriesId,
                $skipped ? 'skipped' : 'normal',
                $task['schedule_mode'] ?? ($next['start_at'] === null ? 'flexible' : 'fixed'),
                $task['window_start'] ?? null,
                $task['window_end'] ?? null,
                $reminderMinutes,
                $skipped ? null : self::reminderAt($next['start_at'], $reminderMinutes),
            ]);
        } catch (PDOException $error) {
            // Another request (the reminder cron or a second device) created it first.
            if ($error->getCode() === '23000') {
                $concurrent = self::childId($db, (int) $task['id']);
                if ($concurrent !== null) {
                    return $concurrent;
                }
            }
            throw $error;
        }
        $nextTaskId = (int) $db->lastInsertId();
        $db->prepare('INSERT INTO subtasks (task_id, title, completed, position) SELECT ?, title, 0, position FROM subtasks WHERE task_id = ?')
            ->execute([$nextTaskId, (int) $task['id']]);
        $db->prepare(
            'INSERT IGNORE INTO plan_import_items (plan_import_id, entity_type, entity_id)
             SELECT plan_import_id, "task", ? FROM plan_import_items WHERE entity_type = "task" AND entity_id = ?'
        )->execute([$nextTaskId, (int) $task['id']]);
        return $nextTaskId;
    }

    /**
     * Makes sure every series has its occurrences up to $throughDate (default:
     * through tomorrow), so reminders exist even when the app is not opened.
     */
    public static function ensureContinuity(PDO $db, int $userId, string $timezone, ?string $throughDate = null): void
    {
        $zone = new DateTimeZone($timezone);
        $cutoffLocal = $throughDate === null
            ? new DateTimeImmutable('tomorrow', $zone)
            : new DateTimeImmutable($throughDate, $zone);
        $cutoff = $cutoffLocal->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
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
            $leaves = $leafStatement->fetchAll(PDO::FETCH_ASSOC);
            if ($leaves === []) {
                return;
            }
            $created = 0;
            foreach ($leaves as $leaf) {
                if (self::createNext($db, $leaf, $timezone) !== null) {
                    $created++;
                }
            }
            if ($created === 0) {
                return;
            }
        }

        throw new RuntimeException('Recurring task continuity limit exceeded.');
    }

    public static function ensureSeries(PDO $db, int $userId): void
    {
        $statement = $db->prepare(
            'SELECT id, recurrence_source_task_id, recurrence_series_id, recurrence_rule
             FROM tasks WHERE user_id = ? AND recurrence_rule IS NOT NULL AND recurrence_rule != ""
             ORDER BY id'
        );
        $statement->execute([$userId]);
        $seriesByTask = [];
        $update = $db->prepare('UPDATE tasks SET recurrence_series_id = ? WHERE id = ? AND user_id = ?');
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $task) {
            $taskId = (int) $task['id'];
            $seriesId = self::nullableInt($task['recurrence_series_id'] ?? null);
            $parentId = self::nullableInt($task['recurrence_source_task_id'] ?? null);
            if ($seriesId === null && $parentId !== null) {
                $seriesId = $seriesByTask[$parentId] ?? null;
            }
            if ($seriesId === null) {
                $seriesId = self::createSeries($db, $userId, (string) $task['recurrence_rule']);
            }
            $seriesByTask[$taskId] = $seriesId;
            if (self::nullableInt($task['recurrence_series_id'] ?? null) !== $seriesId) {
                $update->execute([$seriesId, $taskId, $userId]);
            }
        }
    }

    public static function createSeries(PDO $db, int $userId, string $recurrenceRule): int
    {
        $statement = $db->prepare('INSERT INTO task_series (user_id, recurrence_rule) VALUES (?, ?)');
        $statement->execute([$userId, $recurrenceRule]);
        return (int) $db->lastInsertId();
    }

    /**
     * Deletes one occurrence without letting the series bring it back.
     *
     * Continuity regenerates from any occurrence that has no successor, so the
     * successor (created now if needed) is re-linked to the deleted task's
     * predecessor.
     */
    public static function deleteOccurrence(PDO $db, array $task, string $timezone): void
    {
        $taskId = (int) $task['id'];
        $userId = (int) $task['user_id'];
        $parentId = self::nullableInt($task['recurrence_source_task_id'] ?? null);
        $ownTransaction = !$db->inTransaction();
        if ($ownTransaction) {
            $db->beginTransaction();
        }
        try {
            $childId = self::childId($db, $taskId);
            // Only a predecessor that is still recurring would regenerate this
            // occurrence. Without one, deleting the task ends the series as before.
            if ($childId === null && $parentId !== null && self::frequency($task['recurrence_rule'] ?? null) !== null) {
                $parentRule = $db->prepare('SELECT recurrence_rule FROM tasks WHERE id = ? AND user_id = ? LIMIT 1');
                $parentRule->execute([$parentId, $userId]);
                if (self::frequency(($rule = $parentRule->fetchColumn()) === false ? null : (string) $rule) !== null) {
                    $childId = self::createNext($db, $task, $timezone);
                }
            }
            $db->prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')->execute([$taskId, $userId]);
            if ($parentId !== null && $childId !== null) {
                $db->prepare('UPDATE tasks SET recurrence_source_task_id = ? WHERE id = ? AND user_id = ?')
                    ->execute([$parentId, $childId, $userId]);
            }
            if ($ownTransaction) {
                $db->commit();
            }
        } catch (Throwable $error) {
            if ($ownTransaction && $db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
    }

    /**
     * Finds open occurrences whose time was shifted by the old UTC-based
     * generation (e.g. 08:00 became 07:00 after the end of summer time).
     *
     * An occurrence counts as generated by the old code only when its times are
     * exactly what that code would have produced from its predecessor, so edited
     * occurrences keep the time the user chose. Corrections propagate along the
     * chain. Running it twice changes nothing.
     *
     * @param array<int, array<string, mixed>> $tasks
     * @return array<int, array{start_at: ?string, end_at: ?string, due_at: ?string}>
     */
    public static function dstRepairPlan(array $tasks, string $timezone): array
    {
        $byId = [];
        $children = [];
        foreach ($tasks as $task) {
            $byId[(int) $task['id']] = $task;
        }
        foreach ($byId as $id => $task) {
            $parentId = self::nullableInt($task['recurrence_source_task_id'] ?? null);
            if ($parentId !== null && isset($byId[$parentId])) {
                $children[$parentId] = $id;
            }
        }

        $corrected = [];
        $changes = [];
        foreach ($byId as $id => $task) {
            $parentId = self::nullableInt($task['recurrence_source_task_id'] ?? null);
            if ($parentId !== null && isset($byId[$parentId])) {
                continue;
            }
            $corrected[$id] = self::moments($task);
            $current = $id;
            $guard = 0;
            while (isset($children[$current]) && $guard++ < 100000) {
                $parent = $byId[$current];
                $childId = $children[$current];
                $child = $byId[$childId];
                $rule = trim((string) ($parent['recurrence_rule'] ?? '')) ?: trim((string) ($child['recurrence_rule'] ?? ''));
                $original = self::moments($child);
                $generatedByOldCode = self::frequency($rule) !== null;
                foreach (self::MOMENT_COLUMNS as $column) {
                    if (self::legacyNextUtc($parent[$column] ?? null, $rule) !== $original[$column]) {
                        $generatedByOldCode = false;
                        break;
                    }
                }
                $expected = null;
                if ($generatedByOldCode) {
                    $next = self::nextTimestamps([...$parent, ...$corrected[$current], 'recurrence_rule' => $rule], $timezone);
                    if ($next !== null) {
                        $expected = ['start_at' => $next['start_at'], 'end_at' => $next['end_at'], 'due_at' => $next['due_at']];
                    }
                }
                $corrected[$childId] = $expected ?? $original;
                if ($expected !== null && $expected !== $original && in_array($child['status'] ?? '', ['inbox', 'planned', 'in_progress'], true)) {
                    $changes[$childId] = $expected;
                }
                $current = $childId;
            }
        }
        return $changes;
    }

    public static function repairDst(PDO $db, int $userId, string $timezone): int
    {
        $statement = $db->prepare(
            'SELECT id, user_id, recurrence_source_task_id, recurrence_rule, status, start_at, end_at, due_at, reminder_minutes
             FROM tasks
             WHERE user_id = ? AND (recurrence_series_id IS NOT NULL OR recurrence_source_task_id IS NOT NULL OR (recurrence_rule IS NOT NULL AND recurrence_rule != ""))
             ORDER BY id'
        );
        $statement->execute([$userId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $changes = self::dstRepairPlan($rows, $timezone);
        if ($changes === []) {
            return 0;
        }

        $minutesById = [];
        foreach ($rows as $row) {
            $minutesById[(int) $row['id']] = isset($row['reminder_minutes']) ? (int) $row['reminder_minutes'] : null;
        }
        $now = gmdate('Y-m-d H:i:s');
        $update = $db->prepare('UPDATE tasks SET start_at = ?, end_at = ?, due_at = ?, reminder_at = ? WHERE id = ? AND user_id = ?');
        $resetSent = $db->prepare('UPDATE tasks SET reminder_sent_at = NULL, push_reminder_sent_at = NULL WHERE id = ? AND user_id = ?');
        $db->beginTransaction();
        try {
            foreach ($changes as $taskId => $moments) {
                $reminderAt = self::reminderAt($moments['start_at'], $minutesById[$taskId] ?? null);
                $update->execute([$moments['start_at'], $moments['end_at'], $moments['due_at'], $reminderAt, $taskId, $userId]);
                if ($reminderAt !== null && $reminderAt > $now) {
                    $resetSent->execute([$taskId, $userId]);
                }
            }
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
        return count($changes);
    }

    public static function reminderAt(?string $startAt, ?int $minutes): ?string
    {
        if ($startAt === null || $minutes === null) {
            return null;
        }
        return (new DateTimeImmutable($startAt, new DateTimeZone('UTC')))
            ->sub(new DateInterval('PT' . max(0, $minutes) . 'M'))
            ->format('Y-m-d H:i:s');
    }

    private static function childId(PDO $db, int $taskId): ?int
    {
        $statement = $db->prepare('SELECT id FROM tasks WHERE recurrence_source_task_id = ? LIMIT 1');
        $statement->execute([$taskId]);
        $id = $statement->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** @return array{start_at: ?string, end_at: ?string, due_at: ?string} */
    private static function moments(array $task): array
    {
        $moments = [];
        foreach (['start_at', 'end_at', 'due_at'] as $column) {
            $value = $task[$column] ?? null;
            $moments[$column] = $value === null || $value === '' ? null : (string) $value;
        }
        return $moments;
    }

    private static function utcToLocal(string $value, DateTimeZone $zone): DateTimeImmutable
    {
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->setTimezone($zone);
    }

    private static function localToUtc(DateTimeImmutable $local): string
    {
        return $local->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private static function calendarDaysBetween(DateTimeImmutable $from, DateTimeImmutable $to): int
    {
        $utc = new DateTimeZone('UTC');
        $fromDate = new DateTimeImmutable($from->format('Y-m-d'), $utc);
        $toDate = new DateTimeImmutable($to->format('Y-m-d'), $utc);
        return (int) round(($toDate->getTimestamp() - $fromDate->getTimestamp()) / 86400);
    }

    private static function nullableInt(mixed $value): ?int
    {
        return $value === null || $value === '' ? null : (int) $value;
    }
}
