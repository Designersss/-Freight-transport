import "server-only";

import { adminSession } from "@freight/auth/contracts";
import { headers } from "next/headers";
import type { z } from "zod";
import { adminCookies, forwardAdmin } from "./admin-proxy";

type Access =
  | { kind: "authenticated"; data: z.infer<typeof adminSession> }
  | { kind: "anonymous" | "unavailable" };

export async function readAdminSession(): Promise<Access> {
  try {
    const incoming = await headers();
    const cookie = adminCookies(incoming.get("cookie"));
    if (!cookie) return { kind: "anonymous" };
    const response = await forwardAdmin(
      new Request("http://localhost/api/auth/get-session", {
        headers: { cookie },
      }),
      "get-session",
    );
    if ([401, 403].includes(response.status)) return { kind: "anonymous" };
    if (!response.ok) return { kind: "unavailable" };
    const raw: unknown = await response.json();
    if (raw === null) return { kind: "anonymous" };
    return { kind: "authenticated", data: adminSession.parse(raw) };
  } catch {
    return { kind: "unavailable" };
  }
}
