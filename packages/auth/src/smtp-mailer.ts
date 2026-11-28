import { createTransport } from "nodemailer";
import type { AuthConfig } from "./config.js";
import {
  type AuthMailer,
  type AuthMailKind,
  isDeliverableEmail,
} from "./email.js";

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
      const change = kind === "email-change-old" || kind === "email-change-new";
      const changeLink =
        link.origin === config.AUTH_WEB_ORIGIN &&
        /^\/(ru|en)\/email-change-confirmation$/.test(link.pathname) &&
        !link.search &&
        /^#token=[A-Za-z0-9_-]{43}$/.test(link.hash);
      const registration = kind === "registration-email";
      const registrationLink =
        link.origin === config.AUTH_WEB_ORIGIN &&
        /^\/(ru|en)\/signup$/.test(link.pathname) &&
        !link.search &&
        /^#token=[A-Za-z0-9_-]{43}$/.test(link.hash);
      const resetLink =
        link.origin === config.AUTH_BASE_URL &&
        !link.hash &&
        /^\/api\/v1\/auth\/reset-password\/[^/]+$/.test(link.pathname);
      if (
        link.username ||
        link.password ||
        !(change ? changeLink : registration ? registrationLink : resetLink)
      ) {
        throw new Error("Invalid auth mail URL");
      }
      const verification = registration;
      const subject = change
        ? kind === "email-change-old"
          ? "MOVARO — Confirm email change / Подтвердите смену email"
          : "MOVARO — Confirm new email / Подтвердите новый email"
        : verification
          ? "MOVARO — Confirm your email / Подтвердите email"
          : "MOVARO — Reset password / Сброс пароля";
      const instruction = change
        ? kind === "email-change-old"
          ? "Подтвердите запрос на смену email / Confirm your email change request (15 min):"
          : "Подтвердите новый email / Confirm your new email (15 min):"
        : verification
          ? "Продолжите регистрацию / Continue registration (60 min):"
          : "Установите новый пароль / Reset your password (15 min):";
      try {
        const result = await transport.sendMail({
          from: config.SMTP_FROM,
          to: email,
          subject,
          text: `${instruction}\n${link.href}\n\nЕсли вы не запрашивали письмо, проигнорируйте его. / If you did not request this message, ignore it.`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (result.rejected.length || !result.accepted.length) {
          throw new Error("SMTP recipient rejected");
        }
      } catch {
        // Deliberately omit recipient, token, URL, credentials and provider response.
        console.error("AUTH_SMTP_DELIVERY_FAILED");
        // Never propagate provider responses that may include address or message data.
        throw new Error("Auth mail delivery failed");
      }
    },
  };
}
