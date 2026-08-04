<?php

declare(strict_types=1);

namespace Life;

use PHPMailer\PHPMailer\PHPMailer;
use RuntimeException;

final class Mailer
{
    public function send(string $to, string $subject, string $html, string $text): void
    {
        $mail = new PHPMailer(true);
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->isSMTP();
        $mail->Host = Config::require('SMTP_HOST');
        $mail->Port = (int) Config::get('SMTP_PORT', '465');
        $mail->Timeout = 15;
        $mail->Timelimit = 20;
        $mail->SMTPAuth = true;
        $mail->Username = Config::require('SMTP_USERNAME');
        $mail->Password = Config::require('SMTP_PASSWORD');

        $secure = strtolower(Config::get('SMTP_SECURE', 'ssl') ?? 'ssl');
        $mail->SMTPSecure = match ($secure) {
            'ssl', 'smtps' => PHPMailer::ENCRYPTION_SMTPS,
            'tls', 'starttls' => PHPMailer::ENCRYPTION_STARTTLS,
            'none', '' => '',
            default => throw new RuntimeException('SMTP_SECURE must be ssl, tls, or none.'),
        };

        $mail->setFrom(
            Config::require('SMTP_FROM_EMAIL'),
            Config::get('SMTP_FROM_NAME', '人生看板') ?? '人生看板',
        );
        $mail->addAddress($to);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $this->layout($html);
        $mail->AltBody = $text;
        $mail->send();
    }

    private function layout(string $content): string
    {
        return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head>'
            . '<body style="margin:0;background:#f3f0e8;color:#252923;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,sans-serif">'
            . '<div style="max-width:560px;margin:0 auto;padding:36px 20px">'
            . '<div style="background:#fbfaf7;border:1px solid #dedbd1;border-radius:8px;padding:28px">'
            . '<div style="font-size:12px;color:#496d5b;font-weight:700;margin-bottom:18px">人生看板</div>'
            . $content
            . '<p style="margin:26px 0 0;color:#8a8d85;font-size:12px">按柏林时间发送</p>'
            . '</div></div></body></html>';
    }
}
