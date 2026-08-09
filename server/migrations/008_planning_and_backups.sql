CREATE TABLE IF NOT EXISTS task_series (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    recurrence_rule VARCHAR(255) NOT NULL,
    paused_until DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX task_series_user_idx (user_id),
    CONSTRAINT task_series_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tasks
    ADD COLUMN recurrence_series_id BIGINT UNSIGNED NULL AFTER recurrence_source_task_id,
    ADD COLUMN occurrence_state ENUM('normal', 'skipped') NOT NULL DEFAULT 'normal' AFTER recurrence_series_id,
    ADD COLUMN schedule_mode ENUM('fixed', 'window', 'flexible') NOT NULL DEFAULT 'flexible' AFTER occurrence_state,
    ADD COLUMN window_start TIME NULL AFTER schedule_mode,
    ADD COLUMN window_end TIME NULL AFTER window_start,
    ADD INDEX tasks_recurrence_series_idx (recurrence_series_id),
    ADD CONSTRAINT tasks_recurrence_series_fk FOREIGN KEY (recurrence_series_id) REFERENCES task_series(id) ON DELETE SET NULL;

UPDATE tasks SET schedule_mode = 'fixed' WHERE start_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_schedule_blocks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    task_id BIGINT UNSIGNED NOT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    source ENUM('manual', 'ai') NOT NULL DEFAULT 'manual',
    position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX task_schedule_blocks_task_idx (task_id, position),
    INDEX task_schedule_blocks_user_time_idx (user_id, start_at),
    CONSTRAINT task_schedule_blocks_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT task_schedule_blocks_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE user_settings
    ADD COLUMN planning_start_time TIME NOT NULL DEFAULT '09:00:00' AFTER week_starts_on,
    ADD COLUMN planning_end_time TIME NOT NULL DEFAULT '23:30:00' AFTER planning_start_time,
    ADD COLUMN lunch_start_time TIME NOT NULL DEFAULT '12:30:00' AFTER planning_end_time,
    ADD COLUMN lunch_end_time TIME NOT NULL DEFAULT '13:30:00' AFTER lunch_start_time,
    ADD COLUMN dinner_start_time TIME NOT NULL DEFAULT '18:00:00' AFTER lunch_end_time,
    ADD COLUMN dinner_end_time TIME NOT NULL DEFAULT '19:00:00' AFTER dinner_start_time,
    ADD COLUMN planning_buffer_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15 AFTER dinner_end_time;

CREATE TABLE IF NOT EXISTS backup_records (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    kind ENUM('manual', 'daily', 'weekly', 'pre_restore') NOT NULL,
    file_name VARCHAR(190) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    schema_version SMALLINT UNSIGNED NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX backup_records_user_created_idx (user_id, created_at),
    CONSTRAINT backup_records_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
