import "reflect-metadata";
import { parseApiConfig } from "./config/api-config.js";
import { createApp } from "./create-app.js";

async function bootstrap(): Promise<void> {
  const config = parseApiConfig(process.env);
  const app = await createApp(config);
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, config.API_HOST);
  app.getHttpAdapter().getInstance().log.info({ port: config.API_PORT }, "API started");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API startup failed");
  process.exitCode = 1;
});
