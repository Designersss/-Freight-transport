import "server-only";

const paths = new Set([
  "sign-up/email",
  "sign-in/email",
  "sign-out",
  "send-verification-email",
  "request-password-reset",
  "reset-password",
  "profile",
  "username",
]);
const maxBody = 16_384;

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

async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBody) throw new Error("Body limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

export async function forwardAuth(
  request: Request,
  path: string,
): Promise<Response> {
  const method = request.method;
  if (
    method === "POST"
      ? !paths.has(path)
      : method !== "GET" || (path !== "get-session" && path !== "profile")
  )
    return authFailure(404);
  if (new URL(request.url).search) return authFailure(400);
  try {
    const web = configuredOrigin(
      process.env.AUTH_WEB_ORIGIN,
      "http://127.0.0.1:3000",
    );
    const api = configuredOrigin(
      process.env.AUTH_BASE_URL,
      "http://127.0.0.1:4000",
    );
    // RD-04 development bridge only; production auth remains explicitly disabled.
    if (process.env.MOVARO_AUTH_PREVIEW !== "true") return authFailure(503);
    if (method === "POST" && request.headers.get("origin") !== web)
      return authFailure(403);
    const headers = new Headers();
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const agent = request.headers.get("user-agent");
    if (agent) headers.set("user-agent", agent);
    let body: string | undefined;
    if (method === "POST") {
      if (
        request.headers.get("content-type")?.split(";")[0] !==
        "application/json"
      )
        return authFailure(415);
      try {
        body = await boundedBody(request);
      } catch {
        return authFailure(400);
      }
      headers.set("origin", web);
      headers.set("content-type", "application/json");
    }
    const result = await fetch(new URL(`/api/v1/auth/${path}`, api), {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const output = new Headers({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    const type = result.headers.get("content-type");
    if (type?.startsWith("application/json")) output.set("content-type", type);
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
