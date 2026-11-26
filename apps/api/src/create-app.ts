import "reflect-metadata";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { createAppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import type { ApiConfig } from "./config/api-config.js";

export async function createApp(
  config: ApiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    createAppModule(config),
    new FastifyAdapter({
      logger: {
        level: config.LOG_LEVEL,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
      },
      logController: { disableRequestLogging: true },
    }),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  return app;
}
