<?php

declare(strict_types=1);

use Life\Database;

require dirname(__DIR__) . '/bootstrap.php';

$db = Database::connection();
$db->exec('CREATE TABLE IF NOT EXISTS migrations (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, migration VARCHAR(190) NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
// MySQL commits every ALTER/CREATE immediately, so a migration cannot be rolled
// back as a whole. Remember how many statements of an unfinished migration have
// run, so fixing the failing statement and re-running continues where it stopped
// instead of repeating statements that already succeeded.
$db->exec('CREATE TABLE IF NOT EXISTS migration_progress (migration VARCHAR(190) NOT NULL PRIMARY KEY, statements_done INT UNSIGNED NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

$applied = $db->query('SELECT migration FROM migrations')->fetchAll(PDO::FETCH_COLUMN);
$progress = $db->query('SELECT migration, statements_done FROM migration_progress')->fetchAll(PDO::FETCH_KEY_PAIR);
$files = glob(dirname(__DIR__) . '/migrations/*.sql') ?: [];
sort($files);

$saveProgress = $db->prepare('INSERT INTO migration_progress (migration, statements_done) VALUES (?, ?) ON DUPLICATE KEY UPDATE statements_done = VALUES(statements_done)');
$record = $db->prepare('INSERT INTO migrations (migration) VALUES (?)');
$clearProgress = $db->prepare('DELETE FROM migration_progress WHERE migration = ?');

foreach ($files as $file) {
    $name = basename($file);
    if (in_array($name, $applied, true)) {
        continue;
    }

    $sql = file_get_contents($file);
    if ($sql === false) {
        throw new RuntimeException("Unable to read migration: {$name}");
    }

    $statements = array_values(array_filter(
        array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: []),
        // Skip empty pieces and pieces that only contain "--" comments.
        static fn (string $statement): bool => trim((string) preg_replace('/^\s*--.*$/m', '', $statement)) !== '',
    ));
    $done = (int) ($progress[$name] ?? 0);
    if ($done > 0) {
        echo "Resuming {$name} after statement {$done}\n";
    }

    foreach ($statements as $index => $statement) {
        if ($index < $done) {
            continue;
        }
        try {
            $db->exec($statement);
        } catch (Throwable $error) {
            fwrite(STDERR, sprintf("Migration %s failed at statement %d of %d: %s\n", $name, $index + 1, count($statements), $error->getMessage()));
            fwrite(STDERR, "Statements before it are recorded as done; re-running continues from this statement.\n");
            exit(1);
        }
        $saveProgress->execute([$name, $index + 1]);
    }

    $record->execute([$name]);
    $clearProgress->execute([$name]);
    echo "Applied: {$name}\n";
}
