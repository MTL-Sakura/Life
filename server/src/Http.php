<?php

declare(strict_types=1);

namespace Life;

use JsonException;

final class Http
{
    public static function json(array $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, private');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function input(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            self::json(['error' => '请求内容不是有效的 JSON。'], 400);
        }

        if (!is_array($decoded)) {
            self::json(['error' => '请求内容格式不正确。'], 400);
        }

        return $decoded;
    }

    public static function requireMethod(string ...$methods): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if (!in_array($method, $methods, true)) {
            header('Allow: ' . implode(', ', $methods));
            self::json(['error' => '请求方法不受支持。'], 405);
        }
    }
}
