<?php

declare(strict_types=1);

/**
 * A deliberately tiny test harness: the server tests only need plain PHP,
 * so they run on the server or locally without installing PHPUnit.
 */

$GLOBALS['life_tests'] = [];

function test(string $name, callable $body): void
{
    $GLOBALS['life_tests'][] = [$name, $body];
}

function assert_same(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($message !== '' ? $message . ': ' : '')
            . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function assert_true(bool $condition, string $message = 'assertion failed'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}
