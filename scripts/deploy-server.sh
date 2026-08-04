#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="/www/wwwroot/life.snowmoon1824.top"

cd "$APP_ROOT"

composer install --no-dev --prefer-dist --optimize-autoloader
php server/scripts/migrate.php
php server/scripts/create-admin.php

echo "Life Dashboard deployment is ready."
