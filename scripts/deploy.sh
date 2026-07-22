#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-sakura-life}"
APP_DIR="${APP_DIR:-/www/wwwroot/life.snowmoon1824.top}"
BRANCH="${BRANCH:-main}"

find_pm2() {
  local candidate npm_prefix

  candidate="$(command -v pm2 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi

  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "$npm_prefix" && -x "${npm_prefix}/bin/pm2" ]]; then
    echo "${npm_prefix}/bin/pm2"
    return 0
  fi

  for candidate in /usr/local/bin/pm2 /usr/bin/pm2 /www/server/nodejs/*/bin/pm2; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

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

node -e "const v=process.versions.node.split('.').map(Number); if (v[0] < 20 || (v[0] === 20 && v[1] < 9)) { console.error('Node.js 20.9+ is required. Current version: ' + process.versions.node + '. Install/select Node.js 22 in BaoTa first.'); process.exit(1); }"

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

PM2_BIN="$(find_pm2 || true)"
if [[ -z "$PM2_BIN" ]]; then
  echo "PM2 was installed but the pm2 command was not found in PATH."
  echo "Try opening a new SSH terminal, or install PM2 from BaoTa PM2 manager."
  exit 1
fi

npm config set registry "${NPM_REGISTRY:-https://registry.npmjs.org}"
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
if "$PM2_BIN" describe "$APP_NAME" >/dev/null 2>&1; then
  "$PM2_BIN" reload ecosystem.config.cjs --only "$APP_NAME" --update-env
else
  "$PM2_BIN" start ecosystem.config.cjs --only "$APP_NAME"
fi

"$PM2_BIN" save

echo "==> Deploy complete"
