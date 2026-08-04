# 人生看板

一个面向单用户的人生计划与执行看板。第一版已经包含可部署的响应式前端、PHP API、MySQL 数据结构和单用户登录；本地开发时如果 PHP API 不可用，界面会自动使用演示数据。

## 第一版功能

- 今日时间轴与快速收集
- 收集箱与任务状态筛选
- 日、周、月日历视图
- 项目阶段与进度展示
- 每周习惯打卡、补签和休息日入口
- 周度完成率、时间投入和文字回顾
- 账户、柏林时区和邮件提醒设置
- 桌面侧边栏与手机底部导航

## 本地运行

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
- 后端：PHP 8.1+ API
- 数据库：MySQL
- 邮件：PHPMailer + SMTP
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

邮件提醒需要在宝塔“计划任务”中每 5 分钟执行：

```bash
php /www/wwwroot/life.snowmoon1824.top/server/scripts/send-reminders.php
```
