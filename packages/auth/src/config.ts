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
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURITY: z.enum(["tls", "starttls", "local"]),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.email(),
  })
  .superRefine((config, ctx) => {
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
