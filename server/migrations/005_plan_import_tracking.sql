CREATE TABLE IF NOT EXISTS plan_import_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_import_id BIGINT UNSIGNED NOT NULL,
    entity_type ENUM('category', 'project', 'habit', 'task') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY plan_import_items_entity_unique (entity_type, entity_id),
    INDEX plan_import_items_batch_idx (plan_import_id, entity_type),
    CONSTRAINT plan_import_items_batch_fk FOREIGN KEY (plan_import_id) REFERENCES plan_imports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A one-off cleanup of a duplicated plan import used to follow here. It has
-- already run on the production database and does nothing on a new install.
