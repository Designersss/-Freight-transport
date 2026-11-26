import { z } from "zod";

const schema = z.object({
  S3_ENDPOINT: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  }, "Expected HTTP(S) origin without credentials"),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).default("freight-private"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().trim().min(3),
  S3_SECRET_KEY: z.string().min(16),
});

export type StorageConfig = z.infer<typeof schema>;

export function parseStorageConfig(env: Record<string, unknown>): StorageConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid storage environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}
