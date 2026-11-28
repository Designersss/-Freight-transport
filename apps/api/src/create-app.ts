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
import { registerTelegramBotInternalRoute } from "./auth/register-telegram-bot-internal-route.js";
import { parseTelegramBotInternalSecret } from "./auth/telegram-bot-internal-auth.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import type { ApiConfig } from "./config/api-config.js";
import { registerDevelopmentDocs } from "./openapi/document.js";

export async function createApp(
  config: ApiConfig,
  auth?: AuthConfig,
  storage?: StorageConfig,
  telegramBotInternalSecret?: string,
): Promise<NestFastifyApplication> {
  const botSecret = parseTelegramBotInternalSecret({
    ...auth,
    AUTH_TELEGRAM_BOT_INTERNAL_SECRET: telegramBotInternalSecret,
  });
  if (auth?.AUTH_TELEGRAM_BOT_USERNAME && botSecret === undefined) {
    throw new Error("Telegram bot Web API requires internal service secret");
  }
  if (
    botSecret !== undefined &&
    (!auth ||
      config.NODE_ENV === "production" ||
      config.API_HOST !== "127.0.0.1")
  ) {
    throw new Error("Telegram bot internal API requires loopback staging auth");
  }
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, auth, storage),
    new FastifyAdapter({
      trustProxy: false,
      logger: {
        level: config.LOG_LEVEL,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['x-movaro-proxy-secret']",
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
      auth.AUTH_PROXY_SECRET,
    );
    if (botSecret !== undefined) {
      registerTelegramBotInternalRoute(
        app.getHttpAdapter().getInstance(),
        app.get(AuthService),
        botSecret,
      );
    }
  }
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new HttpExceptionFilter(app.get(HttpAdapterHost)));
  if (config.NODE_ENV === "development") {
    registerDevelopmentDocs(app);
  }
  return app;
}
