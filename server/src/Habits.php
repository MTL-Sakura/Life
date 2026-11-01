<?php

declare(strict_types=1);

namespace Life;

use DateTimeImmutable;

final class Habits
{
    /**
     * Streak in days, following the habit's own rhythm.
     *
     * Daily and custom habits: consecutive planned days that were completed.
     * Days that are not planned (e.g. Tuesday for a Mon/Wed/Fri habit) and
     * "rest" days do not break the streak, and today never breaks it before
     * the day is over.
     *
     * Weekly habits ("N times a week"): completed days across consecutive weeks
     * that reached N. The current week always counts while it is in progress.
     *
     * @param array<string, string> $logs local date (Y-m-d) => 'completed' | 'rest'
     * @param int[] $scheduleDays ISO weekdays 1 (Monday) to 7 (Sunday)
     */
    public static function streak(array $logs, string $frequency, int $target, array $scheduleDays, ?string $startDate, DateTimeImmutable $today): int
    {
        $today = $today->setTime(0, 0);
        $start = $startDate !== null && $startDate !== '' ? $today->modify($startDate) : null;
        if ($frequency === 'weekly') {
            return self::weeklyStreak($logs, max(1, $target), $start, $today);
        }

        $planned = $frequency === 'daily' || $scheduleDays === [] ? [1, 2, 3, 4, 5, 6, 7] : array_map('intval', $scheduleDays);
        $streak = 0;
        $cursor = $today;
        for ($day = 0; $day < 800; $day++, $cursor = $cursor->modify('-1 day')) {
            $date = $cursor->format('Y-m-d');
            $status = $logs[$date] ?? null;
            if ($status === 'completed') {
                $streak++;
                continue;
            }
            if ($start !== null && $cursor < $start) {
                break;
            }
            if ($status === 'rest' || $date === $today->format('Y-m-d') || !in_array((int) $cursor->format('N'), $planned, true)) {
                continue;
            }
            break;
        }
        return $streak;
    }

    /** @param array<string, string> $logs */
    private static function weeklyStreak(array $logs, int $target, ?DateTimeImmutable $start, DateTimeImmutable $today): int
    {
        $weekStart = $today->modify('-' . ((int) $today->format('N') - 1) . ' days');
        $streak = 0;
        for ($week = 0; $week < 120; $week++, $weekStart = $weekStart->modify('-7 days')) {
            $completed = 0;
            for ($offset = 0; $offset < 7; $offset++) {
                if (($logs[$weekStart->modify("+{$offset} days")->format('Y-m-d')] ?? null) === 'completed') {
                    $completed++;
                }
            }
            $weekEnd = $weekStart->modify('+7 days');
            $includesStart = $start !== null && $start >= $weekStart && $start < $weekEnd;
            if ($week === 0 || $completed >= $target || $includesStart) {
                $streak += $completed;
            } else {
                break;
            }
            if ($includesStart || ($start !== null && $weekStart <= $start)) {
                break;
            }
        }
        return $streak;
    }
}
