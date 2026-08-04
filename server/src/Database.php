<?php

declare(strict_types=1);

namespace Life;

use PDO;

final class Database
{
    private static ?PDO $connection = null;

    public static function connection(): PDO
    {
        if (self::$connection !== null) {
            return self::$connection;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            Config::require('DB_HOST'),
            Config::get('DB_PORT', '3306'),
            Config::require('DB_DATABASE'),
        );

        self::$connection = new PDO(
            $dsn,
            Config::require('DB_USERNAME'),
            Config::require('DB_PASSWORD'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ],
        );

        self::$connection->exec("SET time_zone = '+00:00'");

        return self::$connection;
    }
}
