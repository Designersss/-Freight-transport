import "reflect-metadata";
import {
  parseRuntimeAuthConfig,
  parseStorageConfig,
} from "@freight/auth/runtime";
import { parseTelegramBotInternalSecret } from "./auth/telegram-bot-internal-auth.js";
import { parseApiConfig } from "./config/api-config.js";
import { createApp } from "./create-app.js";

async function bootstrap(): Promise<void> {
  const config = parseApiConfig(process.env);
  const auth = parseRuntimeAuthConfig(process.env);
  const app = await createApp(
    config,
    auth,
    auth ? parseStorageConfig(process.env) : undefined,
    parseTelegramBotInternalSecret(process.env),
  );
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, config.API_HOST);
  app
    .getHttpAdapter()
    .getInstance()
    .log.info({ port: config.API_PORT }, "API started");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API startup failed");
  process.exitCode = 1;
});
