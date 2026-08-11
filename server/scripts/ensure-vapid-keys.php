<?php

declare(strict_types=1);

use Life\Config;
use Minishlink\WebPush\VAPID;

require dirname(__DIR__) . '/bootstrap.php';

$publicKey = trim(Config::get('WEB_PUSH_PUBLIC_KEY', '') ?? '');
$privateKey = trim(Config::get('WEB_PUSH_PRIVATE_KEY', '') ?? '');
if (($publicKey === '') !== ($privateKey === '')) {
    throw new RuntimeException('WEB_PUSH_PUBLIC_KEY 和 WEB_PUSH_PRIVATE_KEY 必须同时配置。');
}
if ($publicKey !== '' && $privateKey !== '') {
    echo "Web Push keys are ready.\n";
    exit(0);
}

$keys = VAPID::createVapidKeys();
$subject = Config::get('WEB_PUSH_SUBJECT') ?? Config::get('APP_URL', 'https://life.snowmoon1824.top');
$envPath = LIFE_ROOT . '/.env';
if (!is_file($envPath)) {
    throw new RuntimeException('Missing .env file.');
}

$lines = "\n# Browser Web Push\n"
    . 'WEB_PUSH_SUBJECT="' . addcslashes((string) $subject, "\\\"") . "\"\n"
    . 'WEB_PUSH_PUBLIC_KEY="' . $keys['publicKey'] . "\"\n"
    . 'WEB_PUSH_PRIVATE_KEY="' . $keys['privateKey'] . "\"\n";
if (file_put_contents($envPath, $lines, FILE_APPEND | LOCK_EX) === false) {
    throw new RuntimeException('Unable to write Web Push keys to .env.');
}
chmod($envPath, 0600);
echo "Web Push keys generated and saved to .env.\n";
