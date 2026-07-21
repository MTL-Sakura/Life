# Sakura Life

Sakura Life 是一个单用户的人生计划打卡网页应用。第一版方向是可爱治愈的 2D 樱花庭院养成：每天完成学习、健身、生活整理等任务，就让庭院慢慢成长。

## 当前进度

已经完成：

- Next.js + TypeScript 项目骨架
- 单用户密码登录基础逻辑
- Prisma + MySQL 数据模型
- 2D 插画风庭院首页
- 任务库、新建任务、编辑任务、加入今日任务
- 启动 / 完成 / 超额三档打卡
- XP、资源、属性、连续天数和庭院成长更新
- 今日、庭院、日历、我的页面使用数据库记录
- 产品设计文档和 MVP 流程文档

## 本地开发

先复制环境变量：

```bash
cp .env.example .env
```

然后编辑 `.env`：

```env
DATABASE_URL="mysql://sakura_life:password@127.0.0.1:3306/sakura_life"
APP_OWNER_USERNAME="sakura"
APP_OWNER_INITIAL_PASSWORD="change-this-password"
SESSION_SECRET="replace-with-a-long-random-secret-at-least-32-characters"
APP_URL="http://localhost:3000"
```

安装依赖：

```bash
npm install
```

初始化数据库：

```bash
npm run prisma:deploy
npm run db:seed
```

启动开发服务：

```bash
npm run dev
```

访问：

```text
http://localhost:3000
```

## 宝塔部署概要

推荐第一版使用：

- 宝塔 Nginx
- 宝塔 MySQL
- Node.js
- PM2
- GitHub Actions 自动部署

服务器目录建议：

```text
/www/wwwroot/life.snowmoon1824.top
```

首次部署：

```bash
git clone git@github.com:MTL-Sakura/Life.git /www/wwwroot/life.snowmoon1824.top
cd /www/wwwroot/life.snowmoon1824.top
cp .env.production.example .env
# 编辑 .env 后执行：
bash scripts/deploy.sh
```

宝塔网站反向代理：

```text
http://127.0.0.1:3000
```

更完整的上线步骤见：

- [宝塔部署指南](./docs/BAOTA_DEPLOYMENT.md)

服务器需要使用 Node.js 20.9 或更高版本，建议 Node.js 22。部署前先确认：

```bash
node -v
```

### 宝塔 MySQL 配置

在宝塔创建数据库：

```text
数据库名：sakura_life
用户名：sakura_life
密码：使用强密码
```

服务器 `.env` 示例：

```env
DATABASE_URL="mysql://sakura_life:你的密码@127.0.0.1:3306/sakura_life"
APP_OWNER_USERNAME="sakura"
APP_OWNER_INITIAL_PASSWORD="首次登录密码"
SESSION_SECRET="至少 32 位的随机字符串"
APP_URL="https://life.snowmoon1824.top"
```

`APP_OWNER_INITIAL_PASSWORD` 只用于首次 seed 创建 owner 账号。上线后建议登录应用，在「我的」页面修改密码。

## 文档

- [产品设计文档](./docs/PRODUCT_DESIGN.md)
- [MVP 页面与交互流程](./docs/MVP_FLOW.md)
- [GitHub Actions 部署示例](./docs/github-actions-deploy.yml.example)
