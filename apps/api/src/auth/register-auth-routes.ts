import type { FastifyInstance } from "fastify";
import type { AuthService } from "./auth.module.js";

export function registerAuthRoutes(fastify: FastifyInstance, service: AuthService, origin: string): void {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/*",
    bodyLimit: 16_384,
    async handler(request, reply) {
      const target = new URL(request.url, origin);
      const headers = new Headers();
      for (const name of ["origin", "cookie", "content-type", "user-agent", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      // Never trust a client-supplied forwarding or client-IP header.
      headers.set("x-movaro-client-ip", request.ip);
      const result = await service.handle(new Request(target, {
        method: request.method,
        headers,
        ...(request.body === undefined || request.method !== "POST" ? {} : { body: JSON.stringify(request.body) }),
      }));
      reply.code(result.status);
      for (const [name, value] of result.headers) {
        if (name !== "set-cookie") reply.header(name, value);
      }
      const cookies = result.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(result.body ? await result.text() : null);
    },
  });
}
