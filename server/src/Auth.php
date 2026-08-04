<?php

declare(strict_types=1);

namespace Life;

use PDO;

final class Auth
{
    public static function currentUser(PDO $db): ?array
    {
        $userId = $_SESSION['user_id'] ?? null;
        if (!is_int($userId) && !ctype_digit((string) $userId)) {
            return null;
        }

        $statement = $db->prepare('SELECT id, username, email, display_name, timezone FROM users WHERE id = ? LIMIT 1');
        $statement->execute([(int) $userId]);
        $user = $statement->fetch();

        return $user ?: null;
    }

    public static function requireUser(PDO $db): array
    {
        $user = self::currentUser($db);
        if ($user === null) {
            Http::json(['error' => '请先登录。'], 401);
        }

        return $user;
    }

    public static function login(PDO $db, string $username, string $password): ?array
    {
        $statement = $db->prepare('SELECT id, username, password_hash, email, display_name, timezone FROM users WHERE username = ? LIMIT 1');
        $statement->execute([$username]);
        $user = $statement->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return null;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
        unset($user['password_hash']);

        return $user;
    }

    public static function csrfToken(): string
    {
        if (!isset($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
        }

        return (string) $_SESSION['csrf_token'];
    }

    public static function assertCsrf(): void
    {
        $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        $expected = $_SESSION['csrf_token'] ?? '';
        if ($expected === '' || !hash_equals((string) $expected, (string) $provided)) {
            Http::json(['error' => '页面状态已过期，请刷新后重试。'], 419);
        }
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }
}
