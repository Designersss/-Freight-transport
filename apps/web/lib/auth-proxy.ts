import "server-only";

import {
  forwardTrustedProxyIp,
  protectedStagingConfigured,
} from "@freight/auth/proxy-ip";

const paths = new Set([
  "registration/email/start",
  "registration/email/read",
  "registration/email/complete",
  "sign-in/email",
  "sign-out",
  "request-password-reset",
  "reset-password",
  "change-password",
  "account/deactivate",
  "email/change",
  "email/change/confirm",
  "profile/settings",
  "telegram/registration",
  "telegram/start",
  "telegram-bot/browser",
  "username",
  "username/settings",
  "sessions",
]);
const maxBody = 16_384;
const maxPhotoBody = 2 * 1024 * 1024;

function configuredOrigin(value: string | undefined, fallback: string): string {
  const url = new URL(value ?? fallback);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid auth origin");
  return url.origin;
}

export function authFailure(status: number): Response {
  return Response.json(
    { code: "AUTH_REQUEST_FAILED" },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("Body limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

export async function forwardAuth(
  request: Request,
  path: string,
): Promise<Response> {
  const method = request.method;
  const photo = path === "profile/photo";
  const callback = path === "telegram/callback" && method === "GET";
  const allowed = photo
    ? ["GET", "POST", "DELETE"].includes(method)
    : method === "POST"
      ? paths.has(path)
      : method === "GET" &&
        [
          "get-session",
          "profile",
          "username/settings",
          "sessions",
          "telegram/status",
          "telegram/settings",
          "cabinet/company-owner",
          "cabinet/dispatcher",
          "cabinet/driver",
        ].includes(path);
  if (!allowed && !callback) return authFailure(404);
  const query = new URL(request.url).search;
  if ((!callback && query) || query.length > 8192) return authFailure(400);
  try {
    const web = configuredOrigin(
      process.env.AUTH_WEB_ORIGIN,
      "http://127.0.0.1:3000",
    );
    const api = configuredOrigin(
      process.env.AUTH_BASE_URL,
      "http://127.0.0.1:4000",
    );
    // The closed staging bridge requires an authenticated ingress.
    // Production API auth remains explicitly disabled.
    if (
      process.env.MOVARO_AUTH_PREVIEW !== "true" ||
      (process.env.MOVARO_AUTH_STAGING !== undefined &&
        !protectedStagingConfigured(process.env))
    )
      return authFailure(503);
    if (method !== "GET" && request.headers.get("origin") !== web)
      return authFailure(403);
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding !== "identity") return authFailure(415);
    // Next.js exposes a stream even for an empty DELETE request.
    // Accept zero bytes only; never forward a DELETE payload.
    if (method === "DELETE" && request.body) {
      try {
        await boundedBody(request, 0);
      } catch {
        return authFailure(400);
      }
    }
    const headers = new Headers();
    if (
      !forwardTrustedProxyIp(
        request.headers,
        headers,
        process.env.AUTH_PROXY_SECRET,
      )
    )
      return authFailure(403);
    const cookie = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !/^(?:__Secure-)?movaro-admin\./u.test(part))
      .join("; ");
    if (cookie) headers.set("cookie", cookie);
    const agent = request.headers.get("user-agent");
    if (agent) headers.set("user-agent", agent);
    let body: string | Uint8Array<ArrayBuffer> | undefined;
    if (method !== "GET") headers.set("origin", web);
    if (method === "POST") {
      const type = request.headers.get("content-type")?.split(";")[0];
      if (
        !type ||
        (photo
          ? type !== "image/jpeg" && type !== "image/png"
          : type !== "application/json")
      )
        return authFailure(415);
      try {
        const bytes = await boundedBody(
          request,
          photo ? maxPhotoBody : maxBody,
        );
        body = photo ? new Uint8Array(bytes) : bytes.toString("utf8");
      } catch {
        return authFailure(400);
      }
      headers.set("content-type", type);
    }
    const target = new URL(`/api/v1/auth/${path}`, api);
    if (callback) target.search = query;
    const result = await fetch(target, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: callback ? "manual" : "error",
      cache: "no-store",
      signal: AbortSignal.timeout(photo ? 45_000 : 25_000),
    });
    const output = new Headers({
      "cache-control": photo ? "private, no-store" : "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    if (callback && result.status === 303) {
      const location = result.headers.get("location");
      if (!location) return authFailure(502);
      const destination = new URL(location);
      if (
        destination.origin !== web ||
        destination.username ||
        destination.password ||
        destination.hash ||
        ![
          "/ru/account",
          "/en/account",
          "/ru/cabinet",
          "/en/cabinet",
          "/ru/login",
          "/en/login",
        ].includes(destination.pathname) ||
        (destination.pathname.endsWith("/account")
          ? !["", "?telegram=link-error"].includes(destination.search)
          : destination.pathname.endsWith("/cabinet")
            ? Boolean(destination.search)
            : destination.search !== "?telegram=error")
      )
        return authFailure(502);
      for (const cookie of result.headers.getSetCookie())
        output.append("set-cookie", cookie);
      output.set("location", destination.href);
      return new Response(null, { status: 303, headers: output });
    }
    const type = result.headers.get("content-type");
    if (
      type?.startsWith("application/json") ||
      (photo && result.ok && type === "image/jpeg")
    )
      output.set("content-type", type);
    else return authFailure(502);
    for (const cookie of result.headers.getSetCookie())
      output.append("set-cookie", cookie);
    const retry = result.headers.get("retry-after");
    if (retry) output.set("retry-after", retry);
    return new Response(result.body, {
      status: result.status,
      headers: output,
    });
  } catch {
    return authFailure(503);
  }
}
