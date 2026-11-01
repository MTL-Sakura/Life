#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="/www/wwwroot/life.snowmoon1824.top"

cd "$APP_ROOT"

# Install exactly the versions recorded in composer.lock. If this fails, fix
# the lock file in the repository instead of upgrading packages on the server.
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction

php server/scripts/ensure-vapid-keys.php

if id www >/dev/null 2>&1; then
  chown root:www .env
  chmod 640 .env
else
  chmod 600 .env
fi

mkdir -p server/storage/backups server/storage/sessions
if id www >/dev/null 2>&1; then
  chown -R www:www server/storage
fi
chmod 700 server/storage server/storage/backups server/storage/sessions

php server/scripts/migrate.php
php server/scripts/create-admin.php
php server/scripts/repair-recurring-dst.php

echo "Life Dashboard deployment is ready."
