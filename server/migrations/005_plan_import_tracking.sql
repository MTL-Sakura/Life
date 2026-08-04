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

DELETE task
FROM tasks AS task
INNER JOIN plan_imports AS imported
    ON imported.user_id = task.user_id
    AND imported.import_key = 'sakura-daily-routine-v1'
WHERE task.title IN ('晨间启动', '无氧健身 · 周一', '无氧健身 · 周三', '无氧健身 · 周五', '无氧健身 · 周六', 'SharpLingo 第一学习块', 'SharpLingo 第二学习块', '火影手游日常', '三角洲日常', '永劫无间日常', '睡前洗漱护肤')
  AND ABS(TIMESTAMPDIFF(SECOND, task.created_at, imported.created_at)) <= 60;

DELETE habit
FROM habits AS habit
INNER JOIN plan_imports AS imported
    ON imported.user_id = habit.user_id
    AND imported.import_key = 'sakura-daily-routine-v1'
WHERE habit.name IN ('10点前起床', '吃早餐', '无氧健身', 'SharpLingo学习满3小时', 'SharpLingo完成两节新课', '睡前洗漱护肤')
  AND ABS(TIMESTAMPDIFF(SECOND, habit.created_at, imported.created_at)) <= 60;

DELETE project
FROM projects AS project
INNER JOIN plan_imports AS imported
    ON imported.user_id = project.user_id
    AND imported.import_key = 'sakura-daily-routine-v1'
WHERE project.title = 'SharpLingo 学习'
  AND ABS(TIMESTAMPDIFF(SECOND, project.created_at, imported.created_at)) <= 60;

DELETE FROM plan_imports WHERE import_key = 'sakura-daily-routine-v1';
