import type { Pool } from "pg";
import { z } from "zod";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { reserveTelegramRequest } from "./mail-rate-limit.js";
import {
  type TelegramLinkIdentity,
  telegramLinkContext,
  telegramLoginContext,
} from "./telegram-link-context.js";
import { TELEGRAM_ISSUER } from "./telegram-provider.js";
import { readTelegramSettings } from "./telegram-settings.js";
import { readAuthSession } from "./verified-session.js";

const startInput = z.strictObject({
  intent: z.enum(["login", "register", "link"]),
  locale: z.enum(["ru", "en"]),
});
const authorizeResult = z.object({ url: z.string().max(8192) });
const callbackKeys = new Set([
  "code",
  "state",
  "iss",
  "error",
  "error_description",
]);

function allowedAuthorizationUrl(raw: string, config: AuthConfig) {
  const url = new URL(raw);
  const params = url.searchParams;
  return (
    url.origin === TELEGRAM_ISSUER &&
    url.pathname === "/auth" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    params.get("client_id") === config.AUTH_TELEGRAM_CLIENT_ID &&
    params.get("redirect_uri") ===
      new URL("/api/auth/telegram/callback", config.AUTH_WEB_ORIGIN).href &&
    params.get("response_type") === "code" &&
    params.get("code_challenge_method") === "S256" &&
    Boolean(params.get("code_challenge")) &&
    Boolean(params.get("state")) &&
    Boolean(params.get("nonce")) &&
    new Set(params.keys()).size === [...params.keys()].length
  );
}

function validCallback(url: URL): boolean {
  const params = url.searchParams;
  const keys = [...params.keys()];
  return (
    url.search.length <= 8192 &&
    keys.every((key) => callbackKeys.has(key)) &&
    new Set(keys).size === keys.length &&
    Boolean(params.get("state")) &&
    Boolean(params.get("code")) !== Boolean(params.get("error")) &&
    (!params.has("iss") || params.get("iss") === TELEGRAM_ISSUER)
  );
}

export async function handleTelegramOAuth(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  if (!telegramEnabled(config)) return fail(404, "NOT_FOUND");
  const url = new URL(request.url);
  const start = url.pathname === `${AUTH_BASE_PATH}/telegram/start`;
  if (!start && url.pathname !== `${AUTH_BASE_PATH}/telegram/callback`)
    return fail(404, "NOT_FOUND");
  if (request.method !== (start ? "POST" : "GET"))
    return fail(405, "METHOD_NOT_ALLOWED");
  const loginError = (locale: string) =>
    new URL(`/${locale}/login?telegram=error`, config.AUTH_WEB_ORIGIN);
  const linkError = (locale: string) =>
    new URL(`/${locale}/account?telegram=link-error`, config.AUTH_WEB_ORIGIN);
  const redirect = (target: URL) => {
    headers.set("location", target.href);
    return new Response(null, { status: 303, headers });
  };

  try {
    let payload: z.infer<typeof startInput> | undefined;
    if (start) {
      if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
        return fail(403, "INVALID_ORIGIN");
      if (
        url.search ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json"
      )
        return fail(400, "INVALID_REQUEST");
      const parsed = startInput.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      payload = parsed.data;
    } else if (!validCallback(url)) {
      return redirect(loginError("ru"));
    }

    const retry = await reserveTelegramRequest(
      pool,
      start ? "start" : "callback",
    );
    if (retry !== null) {
      headers.set("retry-after", String(retry));
      return start ? fail(429, "RATE_LIMITED") : redirect(loginError("ru"));
    }
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("content-length");
    const current = await readAuthSession(request, config, auth, headers);
    if (current instanceof Response && current.status !== 401)
      return start ? current : redirect(loginError("ru"));
    let identity: TelegramLinkIdentity | null =
      current instanceof Response
        ? null
        : { userId: current.user.id, sessionId: current.session.id };
    const link = payload?.intent === "link";
    const path = start
      ? link
        ? "/link-social"
        : "/sign-in/social"
      : "/callback/telegram";
    const upstream = new URL(`${AUTH_BASE_PATH}${path}`, config.AUTH_BASE_URL);
    if (payload) {
      if (link) {
        if (!identity) return fail(401, "AUTH_REQUIRED");
        const settings = await readTelegramSettings(pool, identity);
        if (!settings?.credential) return fail(403, "AUTH_REQUEST_FAILED");
        if (!settings.fresh) return fail(403, "SESSION_NOT_FRESH");
        if (settings.linked) return fail(409, "AUTH_REQUEST_FAILED");
        identity = { ...identity, revision: settings.revision };
      } else if (identity) {
        return fail(409, "AUTH_REQUEST_FAILED");
      }
      const account = new URL(
        `/${payload.locale}/${link ? "account" : "cabinet"}`,
        config.AUTH_WEB_ORIGIN,
      ).href;
      const response = await telegramLinkContext.run(identity, () =>
        auth.handler(
          new Request(upstream, {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify({
              provider: "telegram",
              ...(link
                ? {}
                : {
                    requestSignUp: payload.intent === "register",
                    newUserCallbackURL: account,
                  }),
              disableRedirect: true,
              callbackURL: account,
              errorCallbackURL: link
                ? linkError(payload.locale).href
                : loginError(payload.locale).href,
            }),
          }),
        ),
      );
      if (!response.ok)
        return fail(
          response.status === 429 ? 429 : 503,
          response.status === 429 ? "RATE_LIMITED" : "AUTH_REQUEST_FAILED",
        );
      const result = authorizeResult.parse(await response.json());
      if (!allowedAuthorizationUrl(result.url, config))
        return fail(503, "AUTH_REQUEST_FAILED");
      for (const cookie of response.headers.getSetCookie())
        headers.append("set-cookie", cookie);
      return Response.json({ url: result.url }, { headers });
    }

    upstream.search = url.search;
    const response = await telegramLoginContext.run({}, () =>
      telegramLinkContext.run(identity, () =>
        auth.handler(new Request(upstream, { headers: upstreamHeaders })),
      ),
    );
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location)
      return redirect(loginError("ru"));
    const target = new URL(location, config.AUTH_BASE_URL);
    if (
      target.origin !== config.AUTH_WEB_ORIGIN ||
      target.username ||
      target.password ||
      target.hash
    )
      return redirect(loginError("ru"));
    for (const locale of ["ru", "en"]) {
      if (
        [`/${locale}/account`, `/${locale}/cabinet`].includes(
          target.pathname,
        ) &&
        !target.search
      ) {
        for (const cookie of response.headers.getSetCookie())
          headers.append("set-cookie", cookie);
        return redirect(target);
      }
      if (
        target.pathname === `/${locale}/account` &&
        target.searchParams.get("telegram") === "link-error"
      )
        return redirect(linkError(locale));
      if (target.pathname === `/${locale}/login`) {
        // Never reflect provider errors, descriptions, codes or state to UI.
        return redirect(loginError(locale));
      }
    }
    return redirect(loginError("ru"));
  } catch {
    return start
      ? fail(503, "AUTH_REQUEST_FAILED")
      : redirect(loginError("ru"));
  }
}
