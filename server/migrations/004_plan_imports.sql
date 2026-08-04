CREATE TABLE IF NOT EXISTS plan_imports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    import_key VARCHAR(120) NOT NULL,
    document_name VARCHAR(190) NOT NULL,
    imported_counts JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY plan_imports_user_key_unique (user_id, import_key),
    CONSTRAINT plan_imports_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
