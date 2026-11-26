import { createTransport } from "nodemailer";
import type { AuthConfig } from "./config.js";
import { type AuthMailer, type AuthMailKind, isDeliverableEmail } from "./email.js";

export function createSmtpMailer(config: AuthConfig): AuthMailer {
  const transport = createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURITY === "tls",
    requireTLS: config.SMTP_SECURITY === "starttls",
    ignoreTLS: config.SMTP_SECURITY === "local",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { rejectUnauthorized: true },
    ...(config.SMTP_USER && config.SMTP_PASSWORD
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
    logger: false,
    debug: false,
  });

  return {
    async send(kind: AuthMailKind, email: string, url: string): Promise<void> {
      if (!isDeliverableEmail(email)) {
        throw new Error("Invalid auth mail recipient");
      }
      const link = new URL(url);
      if (link.origin !== config.AUTH_BASE_URL || link.username || link.password ||
        (kind === "verify-email"
          ? link.pathname !== "/api/v1/auth/verify-email"
          : !/^\/api\/v1\/auth\/reset-password\/[^/]+$/.test(link.pathname))) {
        throw new Error("Invalid auth mail URL");
      }
      const verification = kind === "verify-email";
      try {
        const result = await transport.sendMail({
          from: config.SMTP_FROM,
          to: email,
          subject: verification ? "MOVARO — Confirm your email / Подтвердите email" : "MOVARO — Reset password / Сброс пароля",
          text: verification
            ? `Подтвердите email / Confirm your email:\n${link.href}\n\nЕсли вы не запрашивали письмо, проигнорируйте его. / If you did not request this message, ignore it.`
            : `Установите новый пароль / Reset your password (15 min):\n${link.href}\n\nЕсли вы не запрашивали письмо, проигнорируйте его. / If you did not request this message, ignore it.`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (result.rejected.length || !result.accepted.length) {
          throw new Error("SMTP recipient rejected");
        }
      } catch {
        // Never propagate provider responses that may include address or message data.
        throw new Error("Auth mail delivery failed");
      }
    },
  };
}
