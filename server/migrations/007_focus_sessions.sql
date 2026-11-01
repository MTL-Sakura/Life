ALTER TABLE tasks
    ADD COLUMN is_focus TINYINT(1) NOT NULL DEFAULT 0 AFTER estimated_minutes;

CREATE TABLE focus_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    task_id BIGINT UNSIGNED NOT NULL,
    status ENUM('running', 'paused', 'completed') NOT NULL DEFAULT 'running',
    planned_seconds INT UNSIGNED NOT NULL,
    elapsed_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME NOT NULL,
    last_resumed_at DATETIME NULL,
    ended_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX focus_sessions_task_idx (task_id, id),
    INDEX focus_sessions_user_status_idx (user_id, status),
    CONSTRAINT focus_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT focus_sessions_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A one-off update that marked two imported study tasks as focus tasks used to
-- follow here. It has already run on the production database.
