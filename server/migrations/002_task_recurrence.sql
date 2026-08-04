ALTER TABLE tasks
    ADD COLUMN recurrence_source_task_id BIGINT UNSIGNED NULL AFTER recurrence_rule,
    ADD UNIQUE KEY tasks_recurrence_source_unique (recurrence_source_task_id),
    ADD CONSTRAINT tasks_recurrence_source_fk FOREIGN KEY (recurrence_source_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
