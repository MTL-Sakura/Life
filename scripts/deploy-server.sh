#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="/www/wwwroot/life.snowmoon1824.top"

cd "$APP_ROOT"

if ! composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction; then
  echo "==> Composer lockfile is stale; refreshing PHP dependencies"
  composer update --no-dev --prefer-dist --optimize-autoloader --no-interaction
fi

if ! php -r 'require "vendor/autoload.php"; exit(class_exists("Minishlink\\WebPush\\VAPID") ? 0 : 1);'; then
  echo "==> Web Push dependency is missing; refreshing PHP dependencies"
  composer update --no-dev --prefer-dist --optimize-autoloader --no-interaction
fi

php server/scripts/ensure-vapid-keys.php

if id www >/dev/null 2>&1; then
  chown root:www .env
  chmod 640 .env
else
  chmod 600 .env
fi

php server/scripts/migrate.php
php server/scripts/create-admin.php

mkdir -p server/storage/backups
if id www >/dev/null 2>&1; then
  chown -R www:www server/storage
fi
chmod 700 server/storage server/storage/backups

echo "Life Dashboard deployment is ready."
