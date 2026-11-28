import { createHash, randomBytes } from "node:crypto";

export const REGISTRATION_EMAIL_TTL_SECONDS = 3600;

export function registrationEmailProofHash(token: unknown): string | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  return createHash("sha256").update(token).digest("hex");
}

export function createRegistrationEmailToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}
