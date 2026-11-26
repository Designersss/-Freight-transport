import {
  parseEnvironment,
  serverEnvironmentSchema,
} from "@freight/config/environment";
import { z } from "zod";

const apiConfigSchema = serverEnvironmentSchema.extend({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function parseApiConfig(env: Record<string, unknown>): ApiConfig {
  return parseEnvironment(apiConfigSchema, env, "API");
}
