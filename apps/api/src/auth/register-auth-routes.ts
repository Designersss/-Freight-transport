import { MAX_PROFILE_PHOTO_BYTES } from "@freight/auth/runtime";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "./auth.module.js";

export function registerAuthRoutes(
  fastify: FastifyInstance,
  service: AuthService,
  origin: string,
): void {
  async function forward(request: FastifyRequest, reply: FastifyReply) {
    const target = new URL(request.url, origin);
    const headers = new Headers();
    for (const name of [
      "origin",
      "cookie",
      "content-type",
      "user-agent",
      "sec-fetch-site",
      "sec-fetch-mode",
      "sec-fetch-dest",
    ]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const encoding = request.headers["content-encoding"];
    if (encoding !== undefined && encoding !== "identity") {
      return reply.code(415).send({ code: "INVALID_REQUEST" });
    }
    // Never trust a client-supplied forwarding or client-IP header.
    headers.set("x-movaro-client-ip", request.ip);
    const body =
      request.body === undefined || request.method === "GET"
        ? undefined
        : Buffer.isBuffer(request.body)
          ? new Uint8Array(request.body)
          : JSON.stringify(request.body);
    const result = await service.handle(
      new Request(target, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
    );
    reply.code(result.status);
    for (const [name, value] of result.headers) {
      if (name !== "set-cookie") reply.header(name, value);
    }
    const cookies = result.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    if (!result.body) return reply.send(null);
    return reply.send(Buffer.from(await result.arrayBuffer()));
  }

  fastify.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/*",
    bodyLimit: 16_384,
    handler: forward,
  });
  fastify.register((scope, _options, done) => {
    scope.addContentTypeParser(
      ["image/jpeg", "image/png"],
      { parseAs: "buffer", bodyLimit: MAX_PROFILE_PHOTO_BYTES },
      (_request, body, parsed) => parsed(null, body),
    );
    scope.route({
      method: ["GET", "POST", "DELETE"],
      url: "/api/v1/auth/profile/photo",
      bodyLimit: MAX_PROFILE_PHOTO_BYTES,
      handler: forward,
    });
    done();
  });
}
