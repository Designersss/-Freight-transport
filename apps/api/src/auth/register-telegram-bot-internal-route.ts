import type { FastifyInstance } from "fastify";
import type { AuthService } from "./auth.module.js";
import { authorizeTelegramBotInternalRequest } from "./telegram-bot-internal-auth.js";

export const TELEGRAM_BOT_INTERNAL_PATH = "/internal/telegram-bot";

export function registerTelegramBotInternalRoute(
  fastify: FastifyInstance,
  service: Pick<AuthService, "handleTelegramBotCommand">,
  secret: string,
): void {
  fastify.route({
    method: "POST",
    url: TELEGRAM_BOT_INTERNAL_PATH,
    bodyLimit: 8192,
    async onRequest(request, reply) {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      if (
        !authorizeTelegramBotInternalRequest(
          secret,
          request.raw.socket.remoteAddress,
          request.raw.rawHeaders,
        )
      ) {
        return reply.code(403).send({ code: "AUTH_REQUEST_FAILED" });
      }
      if (request.raw.url !== TELEGRAM_BOT_INTERNAL_PATH) {
        return reply.code(400).send({ code: "INVALID_REQUEST" });
      }
      const encoding = request.headers["content-encoding"];
      const type = request.headers["content-type"];
      if (
        (encoding !== undefined && encoding !== "identity") ||
        typeof type !== "string" ||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)
      ) {
        return reply.code(415).send({ code: "INVALID_REQUEST" });
      }
    },
    async handler(request, reply) {
      try {
        const response = await service.handleTelegramBotCommand(request.body);
        reply.code(response.status);
        reply.type("application/json");
        const retry = response.headers.get("retry-after");
        if (retry) reply.header("retry-after", retry);
        return reply.send(Buffer.from(await response.arrayBuffer()));
      } catch {
        return reply.code(503).send({ code: "AUTH_REQUEST_FAILED" });
      }
    },
    errorHandler(error, _request, reply) {
      const status =
        error instanceof Error && "statusCode" in error
          ? error.statusCode
          : undefined;
      if (status === 400 || status === 413 || status === 415) {
        return reply.code(status).send({ code: "INVALID_REQUEST" });
      }
      return reply.code(503).send({ code: "AUTH_REQUEST_FAILED" });
    },
  });
}
