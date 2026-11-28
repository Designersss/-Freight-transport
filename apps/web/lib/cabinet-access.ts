import "server-only";

import { publicCabinet, publicProfile } from "@freight/auth/contracts";
import { forwardTrustedProxyIp } from "@freight/auth/proxy-ip";
import { headers } from "next/headers";
import type { z } from "zod";
import { forwardAuth } from "./auth-proxy";
import { cabinetPaths } from "./cabinet-paths";

type Profile = z.infer<typeof publicProfile>;
type Role = Profile["role"];

type CabinetAccess =
  | { kind: "allowed"; profile: Profile }
  | { kind: "anonymous" | "denied" | "unavailable" };

async function read(path: string) {
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  if (!cookie) return new Response(null, { status: 401 });
  const forwarded = new Headers({ cookie });
  if (
    !forwardTrustedProxyIp(incoming, forwarded, process.env.AUTH_PROXY_SECRET)
  )
    return new Response(null, { status: 403 });
  const agent = incoming.get("user-agent");
  if (agent) forwarded.set("user-agent", agent);
  // Reuse the fixed-origin, no-store auth bridge; no Host or URL from clients.
  return forwardAuth(
    new Request(`http://localhost/api/auth/${path}`, { headers: forwarded }),
    path,
  );
}

function failure(status: number): CabinetAccess {
  if (status === 401) return { kind: "anonymous" };
  if (status === 403) return { kind: "denied" };
  return { kind: "unavailable" };
}

export async function readCabinetAccess(
  required?: Role,
): Promise<CabinetAccess> {
  try {
    if (required) {
      const result = await read(cabinetPaths[required].slice(1));
      if (!result.ok) return failure(result.status);
      const access = publicCabinet.parse(await result.json());
      if (access.role !== required) return { kind: "denied" };
    }
    const result = await read("profile");
    if (!result.ok) return failure(result.status);
    const raw: unknown = await result.json();
    if (raw === null) return { kind: "denied" };
    const profile = publicProfile.parse(raw);
    if (required && profile.role !== required) return { kind: "denied" };
    return { kind: "allowed", profile };
  } catch {
    return { kind: "unavailable" };
  }
}
