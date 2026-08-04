# Life Plan JSON

“设置 → 数据 → 计划导入”接受 `schemaVersion: 1` 的 JSON。导入采用追加模式，并通过 `importKey` 阻止同一份计划重复写入。

```json
{
  "schemaVersion": 1,
  "importKey": "unique-plan-v1",
  "name": "计划名称",
  "startDate": "today",
  "timezone": "Europe/Berlin",
  "categories": [],
  "projects": [],
  "habits": [],
  "tasks": []
}
```

## 日期规则

- `startDate`: `today`、`tomorrow` 或 `YYYY-MM-DD`；省略时默认从今天开始。
- `dateOffset`: 相对 `startDate` 的天数，默认 `0`。
- `weekday`: `1` 到 `7`，分别表示星期一到星期日；存在时优先于 `dateOffset`。
- `startTime`、`dueTime`、`reminderTime`: 使用 `HH:MM`。
- `recurrence`: `none`、`daily`、`weekly`、`monthly`。

## 引用规则

- 每个项目必须有唯一 `key`。
- 任务通过 `projectKey` 引用同一份 JSON 中的项目。
- 任务通过 `category` 引用分类名称；分类不存在时会自动创建。
- `scheduleDays` 使用 `1` 到 `7` 表示星期一到星期日。

服务器会限制单次最多导入 30 个分类、30 个项目、50 个习惯和 200 个任务。所有内容会在同一个数据库事务中写入，任意一项失败时整体回滚。每次导入创建的数据都会关联到导入批次，可以在“设置 → 数据”中整批撤销；已被其他手工任务使用的项目或分类会保留。
