import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        URL.canParse(value) &&
        ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "Expected PostgreSQL URL",
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
});

export type WorkerConfig = z.infer<typeof schema>;

export function parseWorkerConfig(env: Record<string, unknown>): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid worker environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}
