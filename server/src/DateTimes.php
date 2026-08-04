<?php

declare(strict_types=1);

namespace Life;

use DateTimeImmutable;
use DateTimeZone;
use Throwable;

final class DateTimes
{
    public static function toUtc(?string $value, string $timezone): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        try {
            $date = new DateTimeImmutable($value, new DateTimeZone($timezone));
        } catch (Throwable) {
            Http::json(['error' => '日期或时间格式不正确。'], 422);
        }

        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    public static function fromUtc(?string $value, string $timezone): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))
            ->setTimezone(new DateTimeZone($timezone))
            ->format(DATE_ATOM);
    }

    public static function berlinWeekBounds(string $timezone): array
    {
        $zone = new DateTimeZone($timezone);
        $start = new DateTimeImmutable('monday this week 00:00:00', $zone);
        $end = $start->modify('+7 days');

        return [
            $start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            $end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
            $start,
        ];
    }
}
