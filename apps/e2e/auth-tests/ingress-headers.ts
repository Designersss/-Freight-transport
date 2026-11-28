// Only used by the isolated loopback browser suite, never application code.
export function ingressHeaders(ip: string): Record<string, string> {
  const secret = process.env.AUTH_BROWSER_PROXY_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/.test(secret))
    throw new Error("Missing isolated browser proxy secret");
  return {
    "x-movaro-proxy-ip": ip,
    "x-movaro-proxy-secret": secret,
  };
}
