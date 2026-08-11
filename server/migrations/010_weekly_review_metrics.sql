CREATE TABLE IF NOT EXISTS daily_task_decisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    task_id BIGINT UNSIGNED NULL,
    local_date DATE NOT NULL,
    action ENUM('tomorrow', 'later', 'drop') NOT NULL,
    task_title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX daily_task_decisions_user_date_idx (user_id, local_date),
    INDEX daily_task_decisions_task_idx (task_id),
    CONSTRAINT daily_task_decisions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT daily_task_decisions_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
