ALTER TABLE tasks
    ADD COLUMN actual_minutes SMALLINT UNSIGNED NULL AFTER estimated_minutes;

ALTER TABLE daily_task_decisions
    ADD COLUMN failure_reason ENUM('time', 'energy', 'interrupted', 'difficult', 'resistance', 'changed') NULL AFTER action;
