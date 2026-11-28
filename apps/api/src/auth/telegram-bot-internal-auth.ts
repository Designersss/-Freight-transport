import { timingSafeEqual } from "node:crypto";

const secretPattern = /^[0-9a-f]{64}$/;
const localPeers = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// A dedicated secret is optional until the internal bot service is enabled.
// Never reuse a browser, admin, proxy or Telegram credential.
export function parseTelegramBotInternalSecret(
  env: Record<string, unknown>,
): string | undefined {
  const secret = env.AUTH_TELEGRAM_BOT_INTERNAL_SECRET;
  if (secret === undefined) return undefined;
  if (
    typeof secret !== "string" ||
    !secretPattern.test(secret) ||
    [
      env.AUTH_SECRET,
      env.AUTH_ADMIN_SECRET,
      env.AUTH_PROXY_SECRET,
      env.AUTH_TELEGRAM_CLIENT_SECRET,
      env.TELEGRAM_BOT_TOKEN,
    ].includes(secret)
  ) {
    throw new Error("Invalid Telegram bot internal authentication secret");
  }
  return secret;
}

// Inspect the socket peer and raw headers, not Fastify's derived IP or a
// forwarded assertion. The ingress must also deny the internal path.
export function authorizeTelegramBotInternalRequest(
  secret: string | undefined,
  remoteAddress: string | undefined,
  rawHeaders: readonly string[],
): boolean {
  if (
    !secret ||
    !secretPattern.test(secret) ||
    !remoteAddress ||
    !localPeers.has(remoteAddress) ||
    rawHeaders.length % 2 !== 0
  ) {
    return false;
  }
  let authorization: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]?.toLowerCase();
    const value = rawHeaders[index + 1];
    if (!name || value === undefined) return false;
    if (
      name === "cookie" ||
      name === "origin" ||
      name === "forwarded" ||
      name.startsWith("sec-fetch-") ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("x-movaro-proxy-")
    ) {
      return false;
    }
    if (name === "authorization") {
      if (authorization !== undefined) return false;
      authorization = value;
    }
  }
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? "");
  const provided = match?.[1];
  return (
    provided !== undefined &&
    timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(secret, "hex"))
  );
}
