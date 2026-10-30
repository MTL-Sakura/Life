<?php

declare(strict_types=1);

use Life\RecurringTasks;

require_once __DIR__ . '/TestCase.php';
require_once dirname(__DIR__) . '/server/src/RecurringTasks.php';

/**
 * Runs the recurring-task SQL against an in-memory SQLite copy of the task
 * tables. Production uses MySQL, so the one MySQL-only statement is translated.
 */
final class SqliteTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return parent::prepare(str_replace('INSERT IGNORE', 'INSERT OR IGNORE', $query), $options);
    }
}

function taskDatabase(): PDO
{
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('pdo_sqlite is required for the database tests.');
    }
    $db = new SqliteTestPdo('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('CREATE TABLE task_series (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, recurrence_rule TEXT NOT NULL, paused_until TEXT NULL)');
    $db->exec('CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, project_id INTEGER NULL, category_id INTEGER NULL,
        title TEXT NOT NULL, notes TEXT NULL, status TEXT NOT NULL DEFAULT "inbox", priority TEXT NOT NULL DEFAULT "medium",
        start_at TEXT NULL, end_at TEXT NULL, due_at TEXT NULL, estimated_minutes INTEGER NOT NULL DEFAULT 30, is_focus INTEGER NOT NULL DEFAULT 0,
        recurrence_rule TEXT NULL,
        recurrence_source_task_id INTEGER NULL UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
        recurrence_series_id INTEGER NULL REFERENCES task_series(id) ON DELETE SET NULL,
        occurrence_state TEXT NOT NULL DEFAULT "normal", schedule_mode TEXT NOT NULL DEFAULT "flexible",
        window_start TEXT NULL, window_end TEXT NULL, reminder_minutes INTEGER NULL, reminder_at TEXT NULL,
        reminder_sent_at TEXT NULL, push_reminder_sent_at TEXT NULL
    )');
    $db->exec('CREATE TABLE subtasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0)');
    $db->exec('CREATE TABLE plan_import_items (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_import_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, UNIQUE (entity_type, entity_id))');
    return $db;
}

function berlinDaysAgo(int $days, string $time): string
{
    return (new DateTimeImmutable('today', new DateTimeZone('Europe/Berlin')))
        ->modify("-{$days} days")
        ->modify($time)
        ->setTimezone(new DateTimeZone('UTC'))
        ->format('Y-m-d H:i:s');
}

function insertRecurringRoot(PDO $db, string $startUtc): int
{
    $db->prepare('INSERT INTO task_series (user_id, recurrence_rule) VALUES (1, "FREQ=DAILY")')->execute();
    $seriesId = (int) $db->lastInsertId();
    $db->prepare('INSERT INTO tasks (user_id, title, status, start_at, end_at, recurrence_rule, recurrence_series_id, schedule_mode, reminder_minutes)
                  VALUES (1, "晨间启动", "completed", ?, ?, "FREQ=DAILY", ?, "fixed", 10)')
        ->execute([$startUtc, (new DateTimeImmutable($startUtc))->modify('+30 minutes')->format('Y-m-d H:i:s'), $seriesId]);
    return (int) $db->lastInsertId();
}

/** @return array<string, int> local date => task id */
function occurrencesByLocalDate(PDO $db): array
{
    $result = [];
    foreach ($db->query('SELECT id, start_at FROM tasks ORDER BY start_at')->fetchAll() as $row) {
        $local = (new DateTimeImmutable($row['start_at'], new DateTimeZone('UTC')))->setTimezone(new DateTimeZone('Europe/Berlin'));
        assert_same('08:00', $local->format('H:i'), 'wall-clock time of task ' . $row['id']);
        $result[$local->format('Y-m-d')] = (int) $row['id'];
    }
    return $result;
}

function localDate(int $offsetDays): string
{
    return (new DateTimeImmutable('today', new DateTimeZone('Europe/Berlin')))->modify("{$offsetDays} days")->format('Y-m-d');
}

test('continuity fills every day through tomorrow at the same local time', function (): void {
    $db = taskDatabase();
    insertRecurringRoot($db, berlinDaysAgo(3, '08:00'));
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    $dates = array_keys(occurrencesByLocalDate($db));
    assert_same([localDate(-3), localDate(-2), localDate(-1), localDate(0), localDate(1)], $dates);
});

test('deleting today\'s occurrence keeps it deleted', function (): void {
    $db = taskDatabase();
    insertRecurringRoot($db, berlinDaysAgo(2, '08:00'));
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    $today = occurrencesByLocalDate($db)[localDate(0)];
    $task = $db->query("SELECT * FROM tasks WHERE id = {$today}")->fetch();
    RecurringTasks::deleteOccurrence($db, $task, 'Europe/Berlin');
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    $dates = array_keys(occurrencesByLocalDate($db));
    assert_same([localDate(-2), localDate(-1), localDate(1)], $dates);
});

test('deleting the last generated occurrence keeps the series going', function (): void {
    $db = taskDatabase();
    insertRecurringRoot($db, berlinDaysAgo(1, '08:00'));
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    $tomorrow = occurrencesByLocalDate($db)[localDate(1)];
    $task = $db->query("SELECT * FROM tasks WHERE id = {$tomorrow}")->fetch();
    RecurringTasks::deleteOccurrence($db, $task, 'Europe/Berlin');
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    $byDate = occurrencesByLocalDate($db);
    assert_same([localDate(-1), localDate(0), localDate(2)], array_keys($byDate));
    $source = $db->query('SELECT recurrence_source_task_id FROM tasks WHERE id = ' . $byDate[localDate(2)])->fetchColumn();
    assert_same($byDate[localDate(0)], (int) $source, 'day after tomorrow is linked to today');
});

test('deleting a recurring task that has no other occurrences removes the series', function (): void {
    $db = taskDatabase();
    $rootId = insertRecurringRoot($db, berlinDaysAgo(0, '08:00'));
    $root = $db->query("SELECT * FROM tasks WHERE id = {$rootId}")->fetch();
    RecurringTasks::deleteOccurrence($db, $root, 'Europe/Berlin');
    RecurringTasks::ensureContinuity($db, 1, 'Europe/Berlin');
    assert_same(0, (int) $db->query('SELECT COUNT(*) FROM tasks')->fetchColumn());
});

test('creating the next occurrence twice returns the same task', function (): void {
    $db = taskDatabase();
    $rootId = insertRecurringRoot($db, berlinDaysAgo(0, '08:00'));
    $root = $db->query("SELECT * FROM tasks WHERE id = {$rootId}")->fetch();
    $first = RecurringTasks::createNext($db, $root, 'Europe/Berlin');
    $second = RecurringTasks::createNext($db, $root, 'Europe/Berlin');
    assert_same($first, $second);
    assert_same(2, (int) $db->query('SELECT COUNT(*) FROM tasks')->fetchColumn());
});

test('repair rewrites shifted open occurrences in the database', function (): void {
    $db = taskDatabase();
    $start = '2026-10-24 06:00:00';
    $parent = insertRecurringRoot($db, $start);
    $shifted = RecurringTasks::legacyNextUtc($start, 'FREQ=DAILY');
    $db->prepare('INSERT INTO tasks (user_id, title, status, start_at, end_at, recurrence_rule, recurrence_source_task_id, schedule_mode, reminder_minutes)
                  VALUES (1, "晨间启动", "planned", ?, ?, "FREQ=DAILY", ?, "fixed", 10)')
        ->execute([$shifted, RecurringTasks::legacyNextUtc('2026-10-24 06:30:00', 'FREQ=DAILY'), $parent]);
    assert_same(1, RecurringTasks::repairDst($db, 1, 'Europe/Berlin'));
    $row = $db->query('SELECT start_at, end_at, reminder_at FROM tasks WHERE id = 2')->fetch();
    assert_same(['start_at' => '2026-10-25 07:00:00', 'end_at' => '2026-10-25 07:30:00', 'reminder_at' => '2026-10-25 06:50:00'], $row);
    assert_same(0, RecurringTasks::repairDst($db, 1, 'Europe/Berlin'));
});
