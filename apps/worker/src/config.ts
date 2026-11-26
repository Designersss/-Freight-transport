import {
  parseEnvironment,
  serverEnvironmentSchema,
} from "@freight/config/environment";
import { z } from "zod";

const schema = serverEnvironmentSchema.extend({
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
});

export type WorkerConfig = z.infer<typeof schema>;

export function parseWorkerConfig(env: Record<string, unknown>): WorkerConfig {
  return parseEnvironment(schema, env, "worker");
}
