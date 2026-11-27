import {
  InvalidProfilePhotoError,
  MAX_PROFILE_PHOTO_BYTES,
  type PrivateStorage,
  ProfilePhotoBusyError,
} from "@freight/storage";
import type { Pool } from "pg";
import type { EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { reservePhotoRequest } from "./mail-rate-limit.js";
import {
  changeProfilePhoto,
  readProfilePhotoKey,
  reserveProfilePhotoKey,
} from "./profile-photo-record.js";
import { readVerifiedSession } from "./verified-session.js";

async function readUpload(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PROFILE_PHOTO_BYTES) return null;
      chunks.push(value);
    }
    return length ? Buffer.concat(chunks, length) : null;
  } finally {
    await reader.cancel();
  }
}

export async function handleProfilePhoto(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
  storage: PrivateStorage,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  const method = request.method;
  if (!["GET", "POST", "DELETE"].includes(method))
    return fail(405, "METHOD_NOT_ALLOWED");
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");
  if (
    method !== "GET" &&
    request.headers.get("origin") !== config.AUTH_WEB_ORIGIN
  )
    return fail(403, "INVALID_ORIGIN");
  if (method === "DELETE" && request.body) return fail(400, "INVALID_REQUEST");
  const contentType = request.headers.get("content-type");
  if (
    method === "POST" &&
    contentType !== "image/jpeg" &&
    contentType !== "image/png"
  )
    return fail(415, "INVALID_REQUEST");

  try {
    const verified = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
    );
    if (verified instanceof Response) return verified;
    if (verified.access !== "email") return fail(403, "AUTH_REQUEST_FAILED");
    const session = {
      userId: verified.user.id,
      sessionId: verified.session.id,
    };
    const current = await readProfilePhotoKey(pool, session);
    if (current === undefined) return fail(403, "AUTH_REQUEST_FAILED");

    const retry = await reservePhotoRequest(
      pool,
      config.AUTH_SECRET,
      session.userId,
      method === "GET" ? "read" : "write",
    );
    if (retry !== null) {
      headers.set("retry-after", String(retry));
      return fail(429, "RATE_LIMITED");
    }

    if (method === "GET") {
      if (current === null) return fail(404, "NOT_FOUND");
      const photo = await storage.getProfilePhoto(current);
      const latest = await readProfilePhotoKey(pool, session);
      if (latest === undefined) return fail(403, "AUTH_REQUEST_FAILED");
      if (latest !== current) return fail(409, "AUTH_REQUEST_FAILED");
      headers.set("content-type", photo.contentType);
      return new Response(new Uint8Array(photo.bytes), { headers });
    }
    if (method === "DELETE") {
      const changed = await changeProfilePhoto(pool, session, null);
      return changed === "updated"
        ? Response.json({ success: true }, { headers })
        : fail(403, "AUTH_REQUEST_FAILED");
    }

    const bytes = await readUpload(request);
    if (!bytes) return fail(400, "INVALID_REQUEST");
    if (contentType === null) return fail(415, "INVALID_REQUEST");
    const key = await reserveProfilePhotoKey(pool, session);
    if (!key) return fail(403, "AUTH_REQUEST_FAILED");
    // Reserve before S3 PUT. On failure the durable cleanup row remains.
    await storage.putProfilePhoto(bytes, contentType, key);
    const changed = await changeProfilePhoto(pool, session, key);
    if (changed === "forbidden") return fail(403, "AUTH_REQUEST_FAILED");
    if (changed === "reservation-expired")
      return fail(409, "AUTH_REQUEST_FAILED");
    return Response.json({ success: true }, { headers });
  } catch (error) {
    if (error instanceof InvalidProfilePhotoError)
      return fail(400, "INVALID_PROFILE_PHOTO");
    if (error instanceof ProfilePhotoBusyError) {
      headers.set("retry-after", "5");
      return fail(503, "AUTH_REQUEST_FAILED");
    }
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
