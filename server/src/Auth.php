<?php

declare(strict_types=1);

namespace Life;

use PDO;

final class Auth
{
    /** Failed logins allowed per window before further attempts are refused. */
    private const MAX_FAILURES_PER_IP = 10;
    private const MAX_FAILURES_PER_USERNAME = 5;
    private const FAILURE_WINDOW_MINUTES = 15;

    public static function currentUser(PDO $db): ?array
    {
        $userId = $_SESSION['user_id'] ?? null;
        if (!is_int($userId) && !ctype_digit((string) $userId)) {
            return null;
        }

        $statement = $db->prepare('SELECT id, username, email, display_name, timezone, session_version FROM users WHERE id = ? LIMIT 1');
        $statement->execute([(int) $userId]);
        $user = $statement->fetch();
        if (!$user) {
            return null;
        }

        // Sessions created before session versions existed adopt the current one,
        // so deploying this change does not sign anybody out.
        if (!isset($_SESSION['session_version'])) {
            $_SESSION['session_version'] = (int) $user['session_version'];
        }
        // Changing the password bumps session_version and signs out every other device.
        if ((int) $_SESSION['session_version'] !== (int) $user['session_version']) {
            unset($_SESSION['user_id'], $_SESSION['session_version'], $_SESSION['csrf_token']);
            return null;
        }
        unset($user['session_version']);

        return $user;
    }

    public static function requireUser(PDO $db): array
    {
        $user = self::currentUser($db);
        if ($user === null) {
            Http::json(['error' => '请先登录。', 'code' => 'unauthenticated'], 401);
        }

        return $user;
    }

    /**
     * Seconds until another login may be attempted, or 0 when not throttled.
     */
    public static function throttleSeconds(PDO $db, string $username, string $ip): int
    {
        $since = gmdate('Y-m-d H:i:s', time() - self::FAILURE_WINDOW_MINUTES * 60);
        $byIp = $db->prepare('SELECT COUNT(*), MIN(attempted_at) FROM login_attempts WHERE ip_hash = ? AND succeeded = 0 AND attempted_at >= ?');
        $byIp->execute([self::ipHash($ip), $since]);
        [$ipFailures, $ipOldest] = $byIp->fetch(PDO::FETCH_NUM);
        $byName = $db->prepare('SELECT COUNT(*), MIN(attempted_at) FROM login_attempts WHERE username = ? AND succeeded = 0 AND attempted_at >= ?');
        $byName->execute([self::normalizedUsername($username), $since]);
        [$nameFailures, $nameOldest] = $byName->fetch(PDO::FETCH_NUM);

        $oldest = null;
        if ((int) $ipFailures >= self::MAX_FAILURES_PER_IP) {
            $oldest = (string) $ipOldest;
        }
        if ((int) $nameFailures >= self::MAX_FAILURES_PER_USERNAME && ($oldest === null || (string) $nameOldest > $oldest)) {
            $oldest = (string) $nameOldest;
        }
        if ($oldest === null) {
            return 0;
        }
        $retryAt = strtotime($oldest . ' UTC') + self::FAILURE_WINDOW_MINUTES * 60;
        return max(1, $retryAt - time());
    }

    public static function recordAttempt(PDO $db, string $username, string $ip, bool $succeeded): void
    {
        $db->prepare('INSERT INTO login_attempts (ip_hash, username, succeeded, attempted_at) VALUES (?, ?, ?, UTC_TIMESTAMP())')
            ->execute([self::ipHash($ip), self::normalizedUsername($username), (int) $succeeded]);
        if ($succeeded) {
            // A successful login clears the failure count for this account.
            $db->prepare('DELETE FROM login_attempts WHERE username = ? AND succeeded = 0')
                ->execute([self::normalizedUsername($username)]);
        }
        $db->exec('DELETE FROM login_attempts WHERE attempted_at < UTC_TIMESTAMP() - INTERVAL 7 DAY');
    }

    public static function login(PDO $db, string $username, string $password): ?array
    {
        $statement = $db->prepare('SELECT id, username, password_hash, session_version, email, display_name, timezone FROM users WHERE username = ? LIMIT 1');
        $statement->execute([$username]);
        $user = $statement->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return null;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['session_version'] = (int) $user['session_version'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
        unset($user['password_hash'], $user['session_version']);

        return $user;
    }

    /** Signs out all other devices while keeping the current session. */
    public static function rotateSessionVersion(PDO $db, int $userId): void
    {
        $db->prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')->execute([$userId]);
        $statement = $db->prepare('SELECT session_version FROM users WHERE id = ?');
        $statement->execute([$userId]);
        session_regenerate_id(true);
        $_SESSION['session_version'] = (int) $statement->fetchColumn();
    }

    public static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
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

    private static function ipHash(string $ip): string
    {
        return hash('sha256', $ip, true);
    }

    private static function normalizedUsername(string $username): string
    {
        $username = strtolower(trim($username));
        return function_exists('mb_substr') ? mb_substr($username, 0, 64) : substr($username, 0, 64);
    }
}
