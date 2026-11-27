import { createHash } from "node:crypto";
import type { GenericOAuthConfig } from "better-auth/plugins";
import { z } from "zod";

export const TELEGRAM_ISSUER = "https://oauth.telegram.org";
export const TELEGRAM_PROVIDER_ID = "telegram";

const claims = z.object({
  iss: z.literal(TELEGRAM_ISSUER),
  aud: z.string(),
  sub: z.string().min(1).max(255),
  nonce: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  name: z.string().trim().max(200).optional(),
});

function internalEmail(subject: string): string {
  return `${createHash("sha256").update(subject).digest("hex")}@telegram.invalid`;
}

// Only used as the Generic OAuth getUserInfo callback. Better Auth 1.7.28
// verifies discovery JWKS, issuer, audience and the saved request nonce
// BEFORE invoking this callback. This is projection, NOT JWT verification.
// No other code may use these decoded claims as authentication evidence.
export function createTelegramProvider(
  clientId: string,
  clientSecret: string,
): GenericOAuthConfig {
  if (!/^\d{1,32}$/.test(clientId) || !clientSecret.trim())
    throw new Error("Invalid Telegram OAuth configuration");

  return {
    providerId: TELEGRAM_PROVIDER_ID,
    name: "Telegram",
    discoveryUrl: `${TELEGRAM_ISSUER}/.well-known/openid-configuration`,
    authorizationUrl: `${TELEGRAM_ISSUER}/auth`,
    tokenUrl: `${TELEGRAM_ISSUER}/token`,
    clientId,
    clientSecret,
    tokenEndpointAuth: { method: "client_secret_basic" },
    scopes: ["openid", "profile"],
    pkce: true,
    requireIdTokenVerification: true,
    disableIdTokenNonceBinding: false,
    disableImplicitSignUp: true,
    disableProviderLogout: true,
    overrideUserInfo: false,
    async getUserInfo(tokens) {
      const token = tokens.idToken;
      if (!token || token.length > 32_768) return null;
      const parts = token.split(".");
      const payload = parts[1];
      if (parts.length !== 3 || !payload) return null;
      try {
        const raw: unknown = JSON.parse(
          Buffer.from(payload, "base64url").toString("utf8"),
        );
        const result = claims.safeParse(raw);
        if (!result.success || result.data.aud !== clientId) return null;
        const { sub, name } = result.data;
        return {
          id: sub,
          sub,
          name: name || "Telegram",
          email: internalEmail(sub),
          emailVerified: false,
        };
      } catch {
        return null;
      }
    },
  };
}
