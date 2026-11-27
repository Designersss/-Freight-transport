import "reflect-metadata";
import type { AuthConfig, StorageConfig } from "@freight/auth/runtime";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { LogController } from "fastify";
import { AppModule } from "./app.module.js";
import { AuthService } from "./auth/auth.module.js";
import { registerAuthRoutes } from "./auth/register-auth-routes.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import type { ApiConfig } from "./config/api-config.js";
import { registerDevelopmentDocs } from "./openapi/document.js";

export async function createApp(
  config: ApiConfig,
  auth?: AuthConfig,
  storage?: StorageConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, auth, storage),
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
  if (auth) {
    if (config.NODE_ENV === "production") {
      await app.close();
      throw new Error(
        "Auth production activation requires RD-04 security acceptance",
      );
    }
    registerAuthRoutes(
      app.getHttpAdapter().getInstance(),
      app.get(AuthService),
      auth.AUTH_BASE_URL,
    );
  }
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  if (config.NODE_ENV === "development") {
    registerDevelopmentDocs(app);
  }
  return app;
}
