#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="/www/wwwroot/life.snowmoon1824.top"

cd "$APP_ROOT"

composer install --no-dev --prefer-dist --optimize-autoloader
php server/scripts/ensure-vapid-keys.php
php server/scripts/migrate.php
php server/scripts/create-admin.php

mkdir -p server/storage/backups
if id www >/dev/null 2>&1; then
  chown -R www:www server/storage
fi
chmod 700 server/storage server/storage/backups

echo "Life Dashboard deployment is ready."
