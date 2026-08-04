<?php

declare(strict_types=1);

namespace Life;

use RuntimeException;

final class Config
{
    private static array $values = [];

    public static function load(string $rootPath): void
    {
        $envPath = $rootPath . '/.env';

        if (is_file($envPath)) {
            $values = parse_ini_file($envPath, false, INI_SCANNER_RAW);
            if ($values === false) {
                throw new RuntimeException('Unable to parse .env file.');
            }
            self::$values = $values;
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $environmentValue = getenv($key);
        if ($environmentValue !== false) {
            return $environmentValue;
        }

        if (array_key_exists($key, self::$values)) {
            return (string) self::$values[$key];
        }

        return $default;
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null || $value === '') {
            throw new RuntimeException("Missing required configuration: {$key}");
        }

        return $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOL);
    }
}
