import { parseEnvironment } from "@freight/config/environment";
import { z } from "zod";

const origin = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  }, "Expected HTTP(S) origin")
  .transform((value) => new URL(value).origin);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    AUTH_BASE_URL: origin,
    AUTH_WEB_ORIGIN: origin,
    AUTH_SECRET: z.string().min(32),
    AUTH_ADMIN_ORIGIN: origin.optional(),
    AUTH_ADMIN_SECRET: z.string().min(32).optional(),
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURITY: z.enum(["tls", "starttls", "local"]),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.email(),
    AUTH_TELEGRAM_CLIENT_ID: z
      .string()
      .regex(/^\d{1,32}$/)
      .optional(),
    AUTH_TELEGRAM_CLIENT_SECRET: z.string().min(1).max(512).optional(),
  })
  .superRefine((config, ctx) => {
    if (
      Boolean(config.AUTH_ADMIN_ORIGIN) !== Boolean(config.AUTH_ADMIN_SECRET) ||
      (config.AUTH_ADMIN_SECRET &&
        (config.AUTH_ADMIN_SECRET === config.AUTH_SECRET ||
          config.AUTH_ADMIN_ORIGIN === config.AUTH_WEB_ORIGIN ||
          config.AUTH_ADMIN_ORIGIN === config.AUTH_BASE_URL ||
          (config.NODE_ENV === "production" &&
            !config.AUTH_ADMIN_ORIGIN?.startsWith("https://"))))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_ADMIN_ORIGIN"],
        message: "Admin requires a distinct origin and secret",
      });
    }
    if (
      Boolean(config.AUTH_TELEGRAM_CLIENT_ID) !==
      Boolean(config.AUTH_TELEGRAM_CLIENT_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_TELEGRAM_CLIENT_ID"],
        message: "Telegram OAuth credentials must be paired",
      });
    }
    if (
      config.AUTH_TELEGRAM_CLIENT_ID &&
      !config.AUTH_WEB_ORIGIN.startsWith("https://") &&
      config.NODE_ENV !== "test"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_WEB_ORIGIN"],
        message: "Telegram OAuth requires an HTTPS Web origin",
      });
    }
    if (config.NODE_ENV === "production") {
      for (const field of ["AUTH_BASE_URL", "AUTH_WEB_ORIGIN"] as const) {
        if (!config[field].startsWith("https://")) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "HTTPS required",
          });
        }
      }
    }
    if (
      config.SMTP_SECURITY === "local" &&
      (config.NODE_ENV === "production" ||
        !["127.0.0.1", "localhost", "::1"].includes(config.SMTP_HOST))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_SECURITY"],
        message: "Plain SMTP is restricted to local development/testing",
      });
    }
    if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "SMTP credentials must be paired",
      });
    }
    if (config.SMTP_SECURITY === "local" && config.SMTP_USER) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "Do not send credentials using plain SMTP",
      });
    }
  });

export type AuthConfig = z.infer<typeof schema>;

export function parseAuthConfig(env: Record<string, unknown>): AuthConfig {
  return parseEnvironment(schema, env, "auth");
}

export function telegramEnabled(config: AuthConfig): boolean {
  return Boolean(
    config.AUTH_TELEGRAM_CLIENT_ID && config.AUTH_TELEGRAM_CLIENT_SECRET,
  );
}
