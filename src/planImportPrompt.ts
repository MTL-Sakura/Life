import type { UserSettings } from './types'

export function buildPlanImportPrompt(settings: UserSettings, today: string): string {
  return `你是“人生看板”的日程规划助手。请把我在本提示词末尾写下的自然语言需求，整理为一份可以直接导入 Life Dashboard 的 JSON 文件。

当前环境：
- 今天：${today}
- 时区：${settings.timezone}
- 可安排时段：${settings.planningStartTime}–${settings.planningEndTime}
- 午餐保留：${settings.lunchStartTime}–${settings.lunchEndTime}
- 晚餐保留：${settings.dinnerStartTime}–${settings.dinnerEndTime}
- 相邻任务至少留出 ${settings.planningBufferMinutes} 分钟缓冲

规划原则：
1. 按正常人的起床、饮食、通勤、精力和睡眠逻辑安排，不要填满每一分钟。
2. 严格避开午餐和晚餐时段；运动、出门、洗漱等需要计算准备与收尾时间。
3. 需要深度思考的学习或工作，单个区块建议 45–90 分钟；较长目标拆成多个区块并留出休息。只有这类任务设置 "focus": true。健身、吃饭、家务、通勤和游戏设置 "focus": false 或省略。
4. 区分习惯和日程任务：习惯用于打卡，任务用于占用具体时间。不要创建意义相同、标题重复的任务。
5. 循环事项只在 tasks 中生成一个首次实例，并设置 recurrence。不要为未来每一天手工复制相同任务，系统会自动生成后续实例。
6. 时间冲突时，优先保留高优先级、截止时间和吃饭休息；无法合理安排的事项可以不设 startTime，让它进入收集箱。
7. 如果我的描述缺少非问不可的信息，先最多问 3 个简短问题；信息足够时直接生成文件，不要重复确认。

必须严格使用以下顶层结构：
{
  "schemaVersion": 1,
  "importKey": "life-plan-${today.replaceAll('-', '')}-a7k2",
  "name": "简短计划名称",
  "startDate": "today",
  "timezone": "${settings.timezone}",
  "categories": [],
  "projects": [],
  "habits": [],
  "tasks": []
}

字段规则：
- importKey：3–120 个字符，只能使用英文字母、数字、点、下划线和短横线；每次生成必须唯一。
- startDate：只能是 "today"、"tomorrow" 或不早于今天的 YYYY-MM-DD。
- categories：每项格式为 {"name":"名称","color":"#RRGGBB"}，名称不能重复，最多 30 项。
- projects：每项可包含 key、title、description、area、color、currentStage、stages。key 必须唯一且只能使用英文字母、数字、点、下划线和短横线。
- habits：每项可包含 name、description、color、frequency、targetCount、scheduleDays、reminderTime、allowMakeup。frequency 只能是 daily、weekly、custom；scheduleDays 使用 1–7 表示周一至周日；时间使用 HH:MM 或 null。
- tasks：每项可包含 title、notes、projectKey、category、priority、duration、focus、dateOffset、weekday、startTime、dueTime、recurrence、reminderMinutes、subtasks。
- priority：只能是 low、medium、high。
- duration：整数分钟，范围 1–1440。
- dateOffset：相对 startDate 的非负天数；weekday 为 1–7 且存在时优先于 dateOffset。
- startTime、dueTime：使用 HH:MM 或 null；dueTime 不能早于 startTime；任务不能跨越午夜。
- recurrence：只能是 none、daily、weekly、monthly。非循环任务使用 none。
- projectKey 如果填写，必须引用 projects 中已存在的 key；category 如果填写，应引用 categories 中的名称。
- reminderMinutes：0–10080 的整数。没有 startTime 的任务不要设置提醒。
- subtasks：字符串数组，最多 20 项。
- 数量上限：categories 30、projects 30、habits 50、tasks 200。

输出要求：
- 只能使用上述受支持字段，不要自行添加 scheduleMode、endTime、windowStart、注释或其他字段。
- 生成合法 JSON：使用双引号，不写注释，不写尾随逗号，不包含 Markdown 代码围栏。
- 检查时间冲突、引用关系、字段枚举、循环重复和午夜边界后再输出。
- 将结果作为名为 life-plan-${today.replaceAll('-', '')}.json 的可下载文件提供。如果当前界面不能生成文件，则只回复纯 JSON 内容。

我的计划需求：
【请在这里写下你想完成的事情、固定时间、预计时长、重复频率和优先级】`
}
