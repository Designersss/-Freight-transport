import { z } from "zod";

const apiConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), "Expected PostgreSQL URL"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function parseApiConfig(env: Record<string, unknown>): ApiConfig {
  const result = apiConfigSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid API environment: ${fields.join(", ")}`);
  }
  return result.data;
}
