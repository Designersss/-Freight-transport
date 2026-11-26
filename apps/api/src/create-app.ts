import "reflect-metadata";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { LogController } from "fastify";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import type { ApiConfig } from "./config/api-config.js";
import { registerDevelopmentDocs } from "./openapi/document.js";

export async function createApp(
  config: ApiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({
      logger: {
        level: config.LOG_LEVEL,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
      },
      logController: new LogController({ disableRequestLogging: true }),
    }),
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  if (config.NODE_ENV === "development") {
    registerDevelopmentDocs(app);
  }
  return app;
}
