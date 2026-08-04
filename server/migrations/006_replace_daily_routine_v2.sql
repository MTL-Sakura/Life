DELETE task
FROM tasks AS task
INNER JOIN plan_import_items AS item ON item.entity_type = 'task' AND item.entity_id = task.id
INNER JOIN plan_imports AS imported ON imported.id = item.plan_import_id
WHERE imported.import_key = 'sakura-daily-routine-v2';

DELETE habit
FROM habits AS habit
INNER JOIN plan_import_items AS item ON item.entity_type = 'habit' AND item.entity_id = habit.id
INNER JOIN plan_imports AS imported ON imported.id = item.plan_import_id
WHERE imported.import_key = 'sakura-daily-routine-v2';

DELETE project
FROM projects AS project
INNER JOIN plan_import_items AS item ON item.entity_type = 'project' AND item.entity_id = project.id
INNER JOIN plan_imports AS imported ON imported.id = item.plan_import_id
WHERE imported.import_key = 'sakura-daily-routine-v2'
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.project_id = project.id);

DELETE category
FROM categories AS category
INNER JOIN plan_import_items AS item ON item.entity_type = 'category' AND item.entity_id = category.id
INNER JOIN plan_imports AS imported ON imported.id = item.plan_import_id
WHERE imported.import_key = 'sakura-daily-routine-v2'
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.category_id = category.id);

DELETE FROM plan_imports WHERE import_key = 'sakura-daily-routine-v2';
