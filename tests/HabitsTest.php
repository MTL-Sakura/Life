<?php

declare(strict_types=1);

use Life\Habits;

require_once __DIR__ . '/TestCase.php';
require_once dirname(__DIR__) . '/server/src/Habits.php';

/** @param string[] $dates */
function completed(array $dates): array
{
    return array_fill_keys($dates, 'completed');
}

// Sunday 1 November 2026.
function sunday(): DateTimeImmutable
{
    return new DateTimeImmutable('2026-11-01', new DateTimeZone('Europe/Berlin'));
}

test('daily streak counts consecutive days and today does not break it', function (): void {
    $logs = completed(['2026-10-29', '2026-10-30', '2026-10-31']);
    assert_same(3, Habits::streak($logs, 'daily', 1, [], '2026-10-01', sunday()));
    assert_same(4, Habits::streak($logs + completed(['2026-11-01']), 'daily', 1, [], '2026-10-01', sunday()));
});

test('daily streak breaks on a missed day', function (): void {
    $logs = completed(['2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31']);
    assert_same(2, Habits::streak($logs, 'daily', 1, [], '2026-10-01', sunday()));
});

test('rest days do not break a streak', function (): void {
    $logs = completed(['2026-10-29', '2026-10-31']) + ['2026-10-30' => 'rest'];
    assert_same(2, Habits::streak($logs, 'daily', 1, [], '2026-10-01', sunday()));
});

test('custom habit skips days that are not planned', function (): void {
    // Monday, Wednesday, Friday habit: Tue/Thu/Sat/Sun are not planned.
    $logs = completed(['2026-10-26', '2026-10-28', '2026-10-30']);
    assert_same(3, Habits::streak($logs, 'custom', 1, [1, 3, 5], '2026-10-01', sunday()));
    // Missing Wednesday breaks it.
    $logs = completed(['2026-10-26', '2026-10-30']);
    assert_same(1, Habits::streak($logs, 'custom', 1, [1, 3, 5], '2026-10-01', sunday()));
});

test('streak stops at the habit start date', function (): void {
    $logs = completed(['2026-10-30', '2026-10-31']);
    assert_same(2, Habits::streak($logs, 'daily', 1, [], '2026-10-30', sunday()));
});

test('weekly habit counts weeks that reached the target', function (): void {
    // Target 3: week of 19 Oct has 3, week of 26 Oct has 3, current week (2 Nov starts Monday) is in progress.
    $logs = completed(['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-31']);
    assert_same(6, Habits::streak($logs, 'weekly', 3, [1, 2, 3, 4, 5, 6, 7], '2026-10-01', sunday()));
});

test('weekly habit streak breaks after a week below target', function (): void {
    $logs = completed(['2026-10-19', '2026-10-26', '2026-10-28', '2026-10-31']);
    assert_same(3, Habits::streak($logs, 'weekly', 3, [1, 2, 3, 4, 5, 6, 7], '2026-10-01', sunday()));
});

test('weekly habit current week never breaks the streak', function (): void {
    $monday = new DateTimeImmutable('2026-11-02', new DateTimeZone('Europe/Berlin'));
    $logs = completed(['2026-10-26', '2026-10-28', '2026-10-31']);
    assert_same(3, Habits::streak($logs, 'weekly', 3, [], '2026-10-01', $monday));
});
