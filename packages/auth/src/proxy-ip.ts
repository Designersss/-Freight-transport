import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const PROXY_IP_HEADER = "x-movaro-proxy-ip";
export const PROXY_SECRET_HEADER = "x-movaro-proxy-secret";

type IncomingHeaders = Pick<Headers, "get">;

function normalizeIp(value: string): string | null {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes("%")) return null;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 must share the same bucket as its IPv4 spelling.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (!mapped?.[1] || !mapped[2]) return ip;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

// Match Better Auth's default IPv6 /64 rate-limit boundary. Missing or
// invalid addresses share one conservative bucket, never an arbitrary key.
export function rateLimitClient(value: string | null): string {
  const ip = value ? normalizeIp(value) : null;
  if (!ip) return "unknown";
  if (isIP(ip) === 4) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const prefix = head ? head.split(":") : [];
  const suffix = tail ? tail.split(":") : [];
  const expanded = ip.includes("::")
    ? [
        ...prefix,
        ...Array.from({ length: 8 - prefix.length - suffix.length }, () => "0"),
        ...suffix,
      ]
    : prefix;
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

// Only an ingress that overwrites both headers and knows the dedicated
// server secret may assert the address. Never accept X-Forwarded-For.
export function trustedProxyIp(
  incoming: IncomingHeaders,
  secret: string,
): string | null {
  const provided = incoming.get(PROXY_SECRET_HEADER);
  if (
    !/^[0-9a-f]{64}$/.test(secret) ||
    !provided ||
    !/^[0-9a-f]{64}$/.test(provided) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  )
    return null;
  const ip = incoming.get(PROXY_IP_HEADER);
  return ip ? normalizeIp(ip) : null;
}

// A fresh outbound header set is used by both Web and Admin. In local
// direct mode none of the incoming proxy assertions is propagated.
export function forwardTrustedProxyIp(
  incoming: IncomingHeaders,
  outgoing: Headers,
  secret: string | undefined,
): boolean {
  if (secret === undefined) return true;
  const ip = trustedProxyIp(incoming, secret);
  if (!ip) return false;
  outgoing.set(PROXY_IP_HEADER, ip);
  outgoing.set(PROXY_SECRET_HEADER, secret);
  return true;
}
