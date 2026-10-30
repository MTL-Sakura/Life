<?php

declare(strict_types=1);

// Usage: php tests/run.php
require_once __DIR__ . '/TestCase.php';

foreach (glob(__DIR__ . '/*Test.php') ?: [] as $file) {
    require_once $file;
}

$failed = 0;
foreach ($GLOBALS['life_tests'] as [$name, $body]) {
    try {
        $body();
        echo "  ok  {$name}\n";
    } catch (Throwable $error) {
        $failed++;
        echo "FAIL  {$name}\n      {$error->getMessage()}\n";
    }
}

$total = count($GLOBALS['life_tests']);
echo "\n" . ($total - $failed) . "/{$total} passed\n";
exit($failed === 0 ? 0 : 1);
