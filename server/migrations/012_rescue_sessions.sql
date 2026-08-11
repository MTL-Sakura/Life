ALTER TABLE focus_sessions
    ADD COLUMN session_type ENUM('focus', 'rescue') NOT NULL DEFAULT 'focus' AFTER task_id,
    ADD COLUMN rescue_reason ENUM('low_energy', 'too_big', 'unclear', 'not_convenient') NULL AFTER planned_seconds,
    ADD COLUMN rescue_step VARCHAR(255) NULL AFTER rescue_reason,
    ADD COLUMN rescue_outcome ENUM('continue', 'later') NULL AFTER rescue_step;
