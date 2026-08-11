<?php

declare(strict_types=1);

namespace Life;

use JsonException;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use PDO;
use RuntimeException;

final class PushNotifier
{
    private WebPush $client;

    public function __construct()
    {
        if (!self::configured()) {
            throw new RuntimeException('浏览器推送尚未配置。');
        }

        $this->client = new WebPush([
            'VAPID' => [
                'subject' => Config::require('WEB_PUSH_SUBJECT'),
                'publicKey' => Config::require('WEB_PUSH_PUBLIC_KEY'),
                'privateKey' => Config::require('WEB_PUSH_PRIVATE_KEY'),
            ],
        ], [
            'TTL' => 60 * 60,
            'urgency' => 'high',
            'batchSize' => 50,
            'contentType' => 'application/json',
        ]);
        $this->client->setReuseVAPIDHeaders(true);
    }

    public static function configured(): bool
    {
        foreach (['WEB_PUSH_SUBJECT', 'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY'] as $key) {
            $value = Config::get($key);
            if ($value === null || trim($value) === '') {
                return false;
            }
        }
        return true;
    }

    public function sendToUser(PDO $db, int $userId, array $payload): array
    {
        $statement = $db->prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC');
        $statement->execute([$userId]);
        return $this->sendRows($db, $statement->fetchAll(), $payload);
    }

    public function sendToEndpoint(PDO $db, int $userId, string $endpoint, array $payload): array
    {
        $statement = $db->prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ? LIMIT 1');
        $statement->execute([$userId, hash('sha256', $endpoint, true)]);
        $row = $statement->fetch();
        if ($row === false) {
            throw new RuntimeException('当前设备尚未开启浏览器推送。');
        }
        return $this->sendRows($db, [$row], $payload);
    }

    private function sendRows(PDO $db, array $rows, array $payload): array
    {
        if ($rows === []) {
            return ['sent' => 0, 'failed' => 0, 'expired' => 0];
        }

        try {
            $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('无法生成推送内容。', 0, $error);
        }

        $topic = substr(hash('sha256', (string) ($payload['tag'] ?? $payload['url'] ?? 'life-dashboard')), 0, 32);
        foreach ($rows as $row) {
            $this->client->queueNotification(
                Subscription::create([
                    'endpoint' => (string) $row['endpoint'],
                    'publicKey' => (string) $row['public_key'],
                    'authToken' => (string) $row['auth_token'],
                    'contentEncoding' => (string) $row['content_encoding'],
                ]),
                $json,
                ['topic' => $topic],
            );
        }

        $result = ['sent' => 0, 'failed' => 0, 'expired' => 0];
        foreach ($this->client->flush() as $report) {
            $endpoint = $report->getEndpoint();
            $endpointHash = hash('sha256', $endpoint, true);
            if ($report->isSuccess()) {
                $db->prepare('UPDATE push_subscriptions SET last_success_at = UTC_TIMESTAMP(), failure_count = 0 WHERE endpoint_hash = ?')
                    ->execute([$endpointHash]);
                $result['sent']++;
                continue;
            }
            if ($report->isSubscriptionExpired()) {
                $db->prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?')->execute([$endpointHash]);
                $result['expired']++;
                continue;
            }
            $db->prepare('UPDATE push_subscriptions SET last_failure_at = UTC_TIMESTAMP(), failure_count = failure_count + 1 WHERE endpoint_hash = ?')
                ->execute([$endpointHash]);
            $result['failed']++;
            error_log('Web Push failed: ' . $report->getReason());
        }
        return $result;
    }
}
