# 人生看板

一个面向单用户的人生计划与执行看板。第一版已经包含可部署的响应式前端、PHP API、MySQL 数据结构和单用户登录；本地开发时如果 PHP API 不可用，界面会自动使用演示数据。

当前版本：**v1.14.1** · [项目全景](PROJECT_OVERVIEW.md) · [完整版本记录](CHANGELOG.md) · [发布流程](docs/RELEASE_PROCESS.md) · [GitHub Releases](https://github.com/MTL-Sakura/Life/releases)

## 第一版功能

- 今日时间轴与快速收集
- 晨间启动与晚间收尾：记录精力、选定今日唯一重点、安置未完成任务并统计连续完成天数
- 可持久化的任务专注计时，支持开始、暂停、继续、结束和离开自动暂停
- 启动困难救援：把眼前任务缩成可编辑的 2、5 或 10 分钟最小动作，完成后选择继续原任务或稍后再做
- 可安装到 iPhone 主屏幕的 PWA，支持后台浏览器推送、测试通知和多设备订阅
- 手机通知可直达对应任务，并可立即开始、完成、稍后 10/30 分钟提醒或进入启动困难救援
- 收集箱与任务状态筛选
- 日、周、月日历视图
- 项目阶段与进度展示
- 每周习惯打卡、补签和休息日入口
- 周度完成率、时间投入和文字回顾
- 账户、柏林时区、浏览器推送和邮件提醒设置
- 使用 OpenAI 整理今天或按当前精力重排余下时间，尊重固定安排、任务时间窗、吃饭时间和缓冲，预览确认后再写入日程
- 循环任务支持跳过单次、暂停到指定日期、仅改本次或修改本次及以后
- JSON 完整备份与密码确认恢复，服务器保留每日、每周和恢复前备份
- 从 Life Plan JSON 批量导入项目、习惯和重复任务
- 桌面侧边栏与手机底部导航

## 本地运行

离开自动暂停依赖 Chrome 或 Edge 的 Idle Detection API。首次开始专注时浏览器会请求授权；拒绝授权或使用不支持该接口的浏览器时，手动专注计时仍可正常使用。

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

## 应用架构

- 前端：React、TypeScript、Vite
- 后端：PHP 8.2+ API
- 数据库：MySQL
- 提醒：标准 Web Push + PHPMailer / SMTP
- AI：OpenAI Responses API（默认 `gpt-5.4-mini`）
- 时区：`Europe/Berlin`
- 部署：本地构建前端后推送到 GitHub，宝塔服务器通过 `git pull` 更新，无需 Node 或 PM2 常驻运行

## 服务器更新

宝塔站点运行目录应设置为：

```text
/www/wwwroot/life.snowmoon1824.top/public
```

首次部署时将 `.env.production.example` 复制为 `.env` 并填写 MySQL、登录账户和 SMTP 授权码。以后更新代码：

```bash
cd /www/wwwroot/life.snowmoon1824.top
git pull origin main
bash scripts/deploy-server.sh
```

启用 AI 安排时，还需要在服务器 `.env` 中填写：

```dotenv
OPENAI_API_KEY="sk-proj-你的密钥"
OPENAI_MODEL="gpt-5.4-mini"
OPENAI_DAILY_LIMIT=2
```

AI 每次只整理今天的未完成任务，并可纳入临近截止日期的收集箱任务。晨间可生成整天安排；执行途中可从“现在”或“今日”按当前精力、正常/低能量模式和最晚结束时间重排余下时间。固定任务、用餐和缓冲不会移动，时间窗任务只会在自己的范围内调整；未保留的普通任务会回到收集箱，循环任务只跳过本次。超过 90 分钟的专注任务可以拆成多个区块。建议的有效期为 30 分钟，只有点击“采用安排”后才会修改任务；每日调用上限可通过 `OPENAI_DAILY_LIMIT` 调整。

“现在”页面的“有点难开始”不调用 AI。选择精力不足、任务太大、不知从哪开始或当前不便后，看板会生成一个可编辑的最小动作并启动短计时。救援计时支持暂停和离开检测；结束时可以继续原任务，或把任务延后 30 分钟。卡点、真实投入和后续选择会进入周回顾，并帮助下周安排降低启动阻力。

浏览器推送使用标准 Web Push。部署脚本会在首次更新时自动生成 VAPID 密钥并安全写入 `.env`。iPhone 需要先在 Safari 中将网站添加到主屏幕，并保持“作为网页 App 打开”；随后从桌面图标进入“设置 → 提醒”，点击“开启通知”和“发送测试通知”。测试成功后可以独立关闭任务邮件、每日收尾邮件和逾期邮件。

口述计划可以按照 [Life Plan JSON 格式](docs/PLAN_IMPORT.md)整理，然后在“设置 → 数据 → 计划导入”中粘贴或选择文件。示例见 [`public/examples/sakura-daily-routine-v3.json`](public/examples/sakura-daily-routine-v3.json)。导入只追加数据，不会清空现有看板；同一个 `importKey` 不能重复导入，导入后可在数据设置中整批撤销。

浏览器推送和邮件提醒共用一个宝塔“计划任务”。为了让手机提醒误差不超过约 1 分钟，将执行周期设为“每 1 分钟”：

```bash
/www/server/php/83/bin/php /www/wwwroot/life.snowmoon1824.top/server/scripts/send-reminders.php
```

晚间收尾后，提醒脚本会跳过当天剩余的任务提醒和尚未发送的每日摘要；这个功能沿用同一个计划任务，不需要新增定时脚本。

自动数据备份需要再添加一个“Shell 脚本”计划任务，每天凌晨 03:15 执行：

```bash
su -s /bin/bash -c '/www/server/php/83/bin/php /www/wwwroot/life.snowmoon1824.top/server/scripts/create-backup.php' www
```

脚本每天保留最近 7 份每日备份，并在星期日额外生成一份每周备份，保留最近 4 份。备份位于 `server/storage/backups`，不在网站公开目录中；也可以在“设置 → 数据”中创建、下载或恢复备份。
