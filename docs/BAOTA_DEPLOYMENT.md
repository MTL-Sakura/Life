# Sakura Life 宝塔部署指南

这份文档用于把 Sakura Life 部署到自己的宝塔服务器，并使用宝塔 MySQL。

## 1. 宝塔准备

在宝塔软件商店安装：

- Nginx
- MySQL
- Node.js
- PM2 管理器

Node.js 需要 20.9 或更高版本，建议使用 22。应用默认监听：

```text
127.0.0.1:3000
```

宝塔 Nginx 再把域名反向代理到这个地址。

## 2. 创建 MySQL 数据库

在宝塔面板进入：

```text
数据库 -> 添加数据库
```

建议：

```text
数据库名：sakura_life
用户名：sakura_life
密码：使用强密码
访问权限：本地服务器
字符集：utf8mb4
```

## 3. 准备服务器目录

推荐目录：

```text
/www/wwwroot/life
```

首次拉取代码：

```bash
git clone git@github.com:MTL-Sakura/Life.git /www/wwwroot/life
cd /www/wwwroot/life
```

如果服务器还没有配置 GitHub SSH key，也可以先用 HTTPS：

```bash
git clone https://github.com/MTL-Sakura/Life.git /www/wwwroot/life
cd /www/wwwroot/life
```

## 4. 配置 .env

在服务器项目目录创建：

```bash
cp .env.production.example .env
```

编辑 `.env`：

```env
DATABASE_URL="mysql://sakura_life:你的数据库密码@127.0.0.1:3306/sakura_life"
APP_OWNER_USERNAME="sakura"
APP_OWNER_INITIAL_PASSWORD="你的首次登录密码"
SESSION_SECRET="至少 32 位的随机字符串"
APP_URL="https://life.snowmoon1824.top"
```

注意：

- `DATABASE_URL` 使用宝塔 MySQL 的数据库名、用户名、密码。
- `APP_OWNER_INITIAL_PASSWORD` 只用于首次创建 owner 账号。
- 上线后建议登录应用，在「我的」页面修改密码。
- `.env` 不要提交到 GitHub。

## 5. 首次部署

进入项目目录：

```bash
cd /www/wwwroot/life
```

执行：

```bash
bash scripts/deploy.sh
```

脚本会自动执行：

- 安装 pnpm
- 安装 PM2
- 拉取最新代码
- 安装依赖
- 执行 Prisma MySQL 迁移
- 创建 owner 初始账号和默认任务
- 构建 Next.js
- 用 PM2 启动 `sakura-life`

## 6. 宝塔网站与反向代理

在宝塔面板：

```text
网站 -> 添加站点
```

填写你的域名：

```text
life.snowmoon1824.top
```

然后进入站点设置：

```text
反向代理 -> 添加反向代理
```

填写：

```text
代理名称：sakura-life
目标 URL：http://127.0.0.1:3000
发送域名：$host
```

保存后访问域名。

## 7. SSL

在宝塔站点设置：

```text
SSL -> Let's Encrypt
```

申请证书后开启：

```text
强制 HTTPS
```

## 8. GitHub Actions 自动部署

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions
```

添加这些 Secrets：

```text
SERVER_HOST      服务器 IP
SERVER_USER      SSH 用户，例如 root
SERVER_PORT      SSH 端口，通常是 22
SERVER_SSH_KEY   SSH 私钥内容
DEPLOY_PATH      /www/wwwroot/life
```

当前仓库把 workflow 放在示例文件中：

```text
docs/github-actions-deploy.yml.example
```

如果你的 GitHub token 有 `workflow` 权限，可以把它复制到：

```text
.github/workflows/deploy.yml
```

之后 push 到 `main` 分支后，GitHub Actions 会自动 SSH 到服务器并执行：

```bash
bash /www/wwwroot/life/scripts/deploy.sh
```

## 9. 常用命令

查看应用状态：

```bash
pm2 status
```

查看日志：

```bash
pm2 logs sakura-life
```

重启应用：

```bash
pm2 reload sakura-life --update-env
```

手动部署：

```bash
cd /www/wwwroot/life
bash scripts/deploy.sh
```
