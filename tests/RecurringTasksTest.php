<?php

declare(strict_types=1);

use Life\RecurringTasks;

require_once __DIR__ . '/TestCase.php';
require_once dirname(__DIR__) . '/server/src/RecurringTasks.php';

/** Builds a UTC timestamp from a Berlin wall-clock time. */
function berlin(string $local): string
{
    return (new DateTimeImmutable($local, new DateTimeZone('Europe/Berlin')))
        ->setTimezone(new DateTimeZone('UTC'))
        ->format('Y-m-d H:i:s');
}

function nextStart(string $startUtc, string $rule, string $timezone = 'Europe/Berlin'): array
{
    $next = RecurringTasks::nextTimestamps(['start_at' => $startUtc, 'recurrence_rule' => $rule], $timezone);
    assert_true($next !== null, 'next occurrence exists');
    return $next;
}

test('daily task keeps 08:00 when summer time ends', function (): void {
    $start = berlin('2026-10-24 08:00');
    $next = nextStart($start, 'FREQ=DAILY');
    assert_same(berlin('2026-10-25 08:00'), $next['start_at']);
    assert_same('2026-10-25 07:00:00', $next['start_at']);
    $after = nextStart($next['start_at'], 'FREQ=DAILY');
    assert_same(berlin('2026-10-26 08:00'), $after['start_at']);
});

test('daily task keeps 08:00 when summer time starts', function (): void {
    $next = nextStart(berlin('2027-03-27 08:00'), 'FREQ=DAILY');
    assert_same(berlin('2027-03-28 08:00'), $next['start_at']);
    assert_same('2027-03-28 06:00:00', $next['start_at']);
});

test('weekly task keeps its wall-clock time across DST', function (): void {
    $next = nextStart(berlin('2026-10-21 19:30'), 'FREQ=WEEKLY');
    assert_same(berlin('2026-10-28 19:30'), $next['start_at']);
});

test('monthly task on the 31st does not drift after short months', function (): void {
    $dates = [];
    $start = berlin('2027-01-31 09:00');
    $rule = 'FREQ=MONTHLY';
    for ($index = 0; $index < 4; $index++) {
        $next = nextStart($start, $rule);
        $start = $next['start_at'];
        $rule = $next['rule'];
        $dates[] = (new DateTimeImmutable($start, new DateTimeZone('UTC')))->setTimezone(new DateTimeZone('Europe/Berlin'))->format('Y-m-d H:i');
    }
    assert_same(['2027-02-28 09:00', '2027-03-31 09:00', '2027-04-30 09:00', '2027-05-31 09:00'], $dates);
    assert_same('FREQ=MONTHLY;BYMONTHDAY=31', $rule);
});

test('monthly task on a normal day keeps the rule unchanged', function (): void {
    $next = nextStart(berlin('2026-08-15 10:00'), 'FREQ=MONTHLY');
    assert_same(berlin('2026-09-15 10:00'), $next['start_at']);
    assert_same('FREQ=MONTHLY', $next['rule']);
});

test('monthly task on 29 February returns to the 29th in leap years', function (): void {
    $next = nextStart(berlin('2028-01-29 10:00'), 'FREQ=MONTHLY');
    assert_same(berlin('2028-02-29 10:00'), $next['start_at']);
});

test('end and due times move with the start by calendar days', function (): void {
    $next = RecurringTasks::nextTimestamps([
        'start_at' => berlin('2026-10-24 23:00'),
        'end_at' => berlin('2026-10-25 00:30'),
        'due_at' => berlin('2026-10-26 12:00'),
        'recurrence_rule' => 'FREQ=DAILY',
    ], 'Europe/Berlin');
    assert_same(berlin('2026-10-25 23:00'), $next['start_at']);
    assert_same(berlin('2026-10-26 00:30'), $next['end_at']);
    assert_same(berlin('2026-10-27 12:00'), $next['due_at']);
});

test('due-only tasks repeat by their due time', function (): void {
    $next = RecurringTasks::nextTimestamps(['due_at' => berlin('2026-10-24 18:00'), 'recurrence_rule' => 'FREQ=DAILY'], 'Europe/Berlin');
    assert_same(null, $next['start_at']);
    assert_same(berlin('2026-10-25 18:00'), $next['due_at']);
});

test('unknown rules and tasks without time do not repeat', function (): void {
    assert_same(null, RecurringTasks::nextTimestamps(['start_at' => berlin('2026-10-24 08:00'), 'recurrence_rule' => 'FREQ=YEARLY'], 'Europe/Berlin'));
    assert_same(null, RecurringTasks::nextTimestamps(['recurrence_rule' => 'FREQ=DAILY'], 'Europe/Berlin'));
});

test('timezones without DST keep their time', function (): void {
    $next = nextStart('2026-10-24 00:00:00', 'FREQ=DAILY', 'Asia/Shanghai');
    assert_same('2026-10-25 00:00:00', $next['start_at']);
});

/** Builds a daily chain the way the old UTC-based code generated it. */
function legacyChain(string $firstStartUtc, int $length, array $statuses): array
{
    $rows = [];
    $start = $firstStartUtc;
    for ($index = 0; $index < $length; $index++) {
        $rows[] = [
            'id' => $index + 1,
            'recurrence_source_task_id' => $index === 0 ? null : $index,
            'recurrence_rule' => 'FREQ=DAILY',
            'status' => $statuses[$index] ?? 'completed',
            'start_at' => $start,
            'end_at' => RecurringTasks::legacyNextUtc($start, 'FREQ=DAILY') === null ? null : (new DateTimeImmutable($start, new DateTimeZone('UTC')))->modify('+30 minutes')->format('Y-m-d H:i:s'),
            'due_at' => null,
        ];
        $start = RecurringTasks::legacyNextUtc($start, 'FREQ=DAILY');
    }
    return $rows;
}

function applyPlan(array $rows, array $plan): array
{
    foreach ($rows as &$row) {
        if (isset($plan[(int) $row['id']])) {
            $row = [...$row, ...$plan[(int) $row['id']]];
        }
    }
    return $rows;
}

test('repair moves open occurrences back to their original wall-clock time', function (): void {
    // 23 Oct 08:00 summer time, generated daily in UTC through 31 Oct.
    $rows = legacyChain(berlin('2026-10-23 08:00'), 9, [7 => 'planned', 8 => 'planned']);
    assert_same('2026-10-30 06:00:00', $rows[7]['start_at']);
    $plan = RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin');
    assert_same([8, 9], array_keys($plan));
    assert_same(berlin('2026-10-30 08:00'), $plan[8]['start_at']);
    assert_same(berlin('2026-10-30 08:30'), $plan[8]['end_at']);
    assert_same(berlin('2026-10-31 08:00'), $plan[9]['start_at']);
});

test('repair is idempotent and keeps working after new occurrences', function (): void {
    $rows = applyPlan(legacyChain(berlin('2026-10-23 08:00'), 9, [7 => 'planned', 8 => 'planned']), []);
    $rows = applyPlan($rows, RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin'));
    assert_same([], RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin'));

    $last = end($rows);
    $next = RecurringTasks::nextTimestamps($last, 'Europe/Berlin');
    $rows[] = ['id' => 10, 'recurrence_source_task_id' => 9, 'recurrence_rule' => 'FREQ=DAILY', 'status' => 'planned', 'start_at' => $next['start_at'], 'end_at' => $next['end_at'], 'due_at' => null];
    assert_same([], RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin'));
});

test('repair keeps occurrences the user moved by hand', function (): void {
    $rows = legacyChain(berlin('2026-10-23 08:00'), 9, [7 => 'planned', 8 => 'planned']);
    // The user moved the 30 Oct occurrence to 10:00; the 31 Oct one was generated from it.
    $rows[7]['start_at'] = berlin('2026-10-30 10:00');
    $rows[7]['end_at'] = berlin('2026-10-30 10:30');
    $rows[8]['start_at'] = RecurringTasks::legacyNextUtc($rows[7]['start_at'], 'FREQ=DAILY');
    $rows[8]['end_at'] = RecurringTasks::legacyNextUtc($rows[7]['end_at'], 'FREQ=DAILY');
    assert_same([], RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin'));
});

test('repair never rewrites completed history', function (): void {
    $rows = legacyChain(berlin('2026-10-23 08:00'), 9, []);
    assert_same([], RecurringTasks::dstRepairPlan($rows, 'Europe/Berlin'));
});

test('BYMONTHDAY is read from monthly rules', function (): void {
    assert_same(31, RecurringTasks::monthDay('FREQ=MONTHLY;BYMONTHDAY=31'));
    assert_same(null, RecurringTasks::monthDay('FREQ=MONTHLY'));
    assert_same('monthly', RecurringTasks::frequency('freq=monthly;bymonthday=31'));
});

test('reminders are calculated from the corrected start', function (): void {
    assert_same('2026-10-30 06:50:00', RecurringTasks::reminderAt('2026-10-30 07:00:00', 10));
    assert_same(null, RecurringTasks::reminderAt(null, 10));
});
