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

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
  else
    npm install -g pnpm
  fi
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "==> Fetching latest code"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Applying database migrations"
pnpm prisma:deploy

echo "==> Ensuring owner account and starter data"
pnpm db:seed

echo "==> Building application"
pnpm build

echo "==> Starting or reloading PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs --only "$APP_NAME"
fi

pm2 save

echo "==> Deploy complete"
