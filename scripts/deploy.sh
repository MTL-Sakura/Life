#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-sakura-life}"
APP_DIR="${APP_DIR:-/www/wwwroot/life.snowmoon1824.top}"
BRANCH="${BRANCH:-main}"

echo "==> Deploying ${APP_NAME} in ${APP_DIR}"

cd "$APP_DIR"

if [[ ! -f ".env" ]]; then
  echo "Missing .env in ${APP_DIR}"
  echo "Create it from .env.production.example before deploying."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20.9+ from BaoTa Node.js manager first."
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

npm config set registry "${NPM_REGISTRY:-https://registry.npmmirror.com}"
npm config set audit false
npm config set fund false
npm config set maxsockets 1

echo "==> Fetching latest code"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
npm install --no-audit --no-fund --prefer-offline

echo "==> Applying database migrations"
npm run prisma:deploy

echo "==> Ensuring owner account and starter data"
npm run db:seed

echo "==> Building application"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}" npm run build

echo "==> Starting or reloading PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs --only "$APP_NAME"
fi

pm2 save

echo "==> Deploy complete"
