ALTER TABLE user_settings
    ADD COLUMN push_task_reminders TINYINT(1) NOT NULL DEFAULT 1 AFTER email_reminders,
    ADD COLUMN push_daily_summary TINYINT(1) NOT NULL DEFAULT 1 AFTER daily_summary,
    ADD COLUMN push_overdue_reminder TINYINT(1) NOT NULL DEFAULT 0 AFTER overdue_reminder;

ALTER TABLE tasks
    ADD COLUMN push_reminder_sent_at DATETIME NULL AFTER reminder_sent_at,
    ADD INDEX tasks_push_reminder_idx (reminder_at, push_reminder_sent_at);

ALTER TABLE notification_logs
    DROP INDEX notification_logs_unique,
    ADD COLUMN channel ENUM('email', 'push') NOT NULL DEFAULT 'email' AFTER type,
    ADD UNIQUE KEY notification_logs_channel_unique (user_id, type, channel, reference_key);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    endpoint TEXT NOT NULL,
    endpoint_hash BINARY(32) NOT NULL,
    public_key VARCHAR(255) NOT NULL,
    auth_token VARCHAR(255) NOT NULL,
    content_encoding VARCHAR(32) NOT NULL DEFAULT 'aes128gcm',
    device_name VARCHAR(100) NOT NULL DEFAULT '浏览器设备',
    user_agent VARCHAR(500) NULL,
    last_seen_at DATETIME NOT NULL,
    last_success_at DATETIME NULL,
    last_failure_at DATETIME NULL,
    failure_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY push_subscriptions_endpoint_unique (endpoint_hash),
    INDEX push_subscriptions_user_idx (user_id, updated_at),
    CONSTRAINT push_subscriptions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
