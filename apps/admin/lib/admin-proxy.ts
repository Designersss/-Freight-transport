import "server-only";

function origin(value: string | undefined): string {
  if (!value) throw new Error("Missing admin configuration");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid origin");
  return url.origin;
}

export function adminCookies(value: string | null): string {
  return (value ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      /^(?:__Secure-)?movaro-admin\.[A-Za-z0-9_]+=/u.test(part),
    )
    .join("; ");
}

function failure(status: number): Response {
  return Response.json(
    { code: "AUTH_REQUEST_FAILED" },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function bodyText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new Error("Body limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

export async function forwardAdmin(
  request: Request,
  path: string,
): Promise<Response> {
  const read = path === "get-session";
  if (
    (!read && path !== "sign-in/email" && path !== "sign-out") ||
    request.method !== (read ? "GET" : "POST")
  )
    return failure(404);
  if (process.env.NODE_ENV === "production") return failure(404);
  if (new URL(request.url).search) return failure(400);
  try {
    const admin = origin(process.env.AUTH_ADMIN_ORIGIN);
    const api = origin(process.env.AUTH_BASE_URL);
    if (!read && request.headers.get("origin") !== admin) return failure(403);
    const headers = new Headers();
    const cookie = adminCookies(request.headers.get("cookie"));
    if (cookie) headers.set("cookie", cookie);
    const agent = request.headers.get("user-agent");
    if (agent) headers.set("user-agent", agent);
    let body: string | undefined;
    if (!read) {
      if (
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json" ||
        ![null, "identity"].includes(request.headers.get("content-encoding"))
      )
        return failure(415);
      try {
        body = await bodyText(request);
      } catch {
        return failure(400);
      }
      headers.set("origin", admin);
      headers.set("content-type", "application/json");
    }
    const result = await fetch(new URL(`/api/v1/auth/admin/${path}`, api), {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
    if (!result.headers.get("content-type")?.startsWith("application/json"))
      return failure(502);
    const output = new Headers({
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    for (const cookie of result.headers.getSetCookie()) {
      if (!adminCookies(cookie.split(";")[0] ?? "")) return failure(502);
      output.append("set-cookie", cookie);
    }
    const retry = result.headers.get("retry-after");
    if (retry) output.set("retry-after", retry);
    return new Response(result.body, { status: result.status, headers: output });
  } catch {
    return failure(503);
  }
}
