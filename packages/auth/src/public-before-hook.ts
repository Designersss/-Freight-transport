import type { BetterAuthOptions } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import type { Pool } from "pg";
import {
  prepareCredentialLogin,
  preparePasswordChange,
  preparePasswordReset,
} from "./credential-login.js";
import { registrationContext } from "./registration-context.js";

export function createPublicBeforeHook(
  pool: Pool,
): NonNullable<NonNullable<BetterAuthOptions["hooks"]>["before"]> {
  return createAuthMiddleware(async (ctx) => {
    if (
      ctx.path === "/verify-email" ||
      ctx.path === "/send-verification-email" ||
      (ctx.path === "/sign-up/email" && !registrationContext.getStore())
    )
      throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
    if (ctx.path === "/sign-in/email" || ctx.path === "/request-password-reset")
      return prepareCredentialLogin(pool, ctx.body?.email);
    if (ctx.path === "/change-password") {
      const session = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
        disableRefresh: true,
      });
      if (!session) throw new APIError("UNAUTHORIZED");
      const proof = await preparePasswordChange(
        pool,
        session.user.id,
        session.session.id,
      );
      if (!proof)
        throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
      return proof;
    }
    if (ctx.path === "/reset-password") {
      const proof = await preparePasswordReset(pool, ctx.body?.token);
      if (!proof)
        throw new APIError("BAD_REQUEST", { code: "AUTH_REQUEST_FAILED" });
      return proof;
    }
    if (
      ctx.path === "/unlink-account" ||
      ctx.path === "/link-social" ||
      ctx.path === "/sign-in/social"
    )
      throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
  });
}
