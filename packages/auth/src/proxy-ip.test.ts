import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminPreviewAllowed,
  forwardTrustedProxyIp,
  PROXY_IP_HEADER,
  PROXY_SECRET_HEADER,
  protectedStagingConfigured,
  rateLimitClient,
  trustedProxyIp,
} from "./proxy-ip.ts";

const secret = "a".repeat(64);

function assertion(ip: string, token = secret): Headers {
  return new Headers({
    [PROXY_IP_HEADER]: ip,
    [PROXY_SECRET_HEADER]: token,
  });
}

describe("trusted auth proxy address", () => {
  it("ignores arbitrary forwarding headers in direct mode", () => {
    const incoming = assertion("203.0.113.10");
    incoming.set("x-forwarded-for", "198.51.100.10");
    incoming.set("x-movaro-client-ip", "198.51.100.11");
    const outgoing = new Headers();
    assert.equal(forwardTrustedProxyIp(incoming, outgoing, undefined), true);
    assert.deepEqual([...outgoing], []);
  });

  it("forwards only the authenticated canonical address", () => {
    const incoming = assertion("2001:0DB8:0:0:0:0:0:1");
    incoming.set("x-forwarded-for", "198.51.100.10");
    const outgoing = new Headers();
    assert.equal(forwardTrustedProxyIp(incoming, outgoing, secret), true);
    assert.equal(trustedProxyIp(outgoing, secret), "2001:db8::1");
    assert.equal(outgoing.get("x-forwarded-for"), null);
  });

  it("normalizes IPv4-mapped IPv6", () => {
    assert.equal(
      trustedProxyIp(assertion("::ffff:192.0.2.1"), secret),
      "192.0.2.1",
    );
    assert.equal(
      trustedProxyIp(assertion("::ffff:c000:201"), secret),
      "192.0.2.1",
    );
  });

  it("rejects missing and incorrect credentials", () => {
    for (const incoming of [
      new Headers({ "x-forwarded-for": "192.0.2.1" }),
      assertion("192.0.2.1", "b".repeat(64)),
      assertion("192.0.2.1", `${secret}, ${secret}`),
      assertion("192.0.2.1", ""),
    ]) {
      const outgoing = new Headers();
      assert.equal(forwardTrustedProxyIp(incoming, outgoing, secret), false);
      assert.deepEqual([...outgoing], []);
    }
  });

  it("groups IPv6 clients by /64 and preserves IPv4 identity", () => {
    assert.equal(rateLimitClient("2001:db8:0:1::1"), "2001:db8:0:1::/64");
    assert.equal(rateLimitClient("2001:0db8:0:1:abcd::2"), "2001:db8:0:1::/64");
    assert.equal(rateLimitClient("2001:db8:0:2::1"), "2001:db8:0:2::/64");
    assert.equal(rateLimitClient("::ffff:192.0.2.1"), "192.0.2.1");
    assert.equal(rateLimitClient("192.0.2.1"), "192.0.2.1");
    assert.equal(rateLimitClient("forged"), "unknown");
    assert.equal(rateLimitClient(null), "unknown");
  });

  it("rejects multiple addresses, ports and scoped IPv6", () => {
    for (const ip of [
      "192.0.2.1, 192.0.2.2",
      "192.0.2.1:1234",
      "[2001:db8::1]",
      "fe80::1%eth0",
      "example.test",
      "",
    ])
      assert.equal(trustedProxyIp(assertion(ip), secret), null);
  });
});

describe("protected staging", () => {
  const env = {
    NODE_ENV: "production",
    MOVARO_AUTH_STAGING: "true",
    AUTH_BASE_URL: "http://127.0.0.1:4000",
    AUTH_WEB_ORIGIN: "https://web.example.test",
    AUTH_ADMIN_ORIGIN: "https://admin.example.test",
    AUTH_PROXY_SECRET: secret,
  };

  it("allows only configured staging with an authenticated ingress", () => {
    assert.equal(protectedStagingConfigured(env), true);
    assert.equal(adminPreviewAllowed(assertion("192.0.2.1"), env), true);
    assert.equal(adminPreviewAllowed(new Headers(), env), false);
    assert.equal(
      adminPreviewAllowed(assertion("192.0.2.1", "b".repeat(64)), env),
      false,
    );
    assert.equal(
      adminPreviewAllowed(new Headers(), { NODE_ENV: "production" }),
      false,
    );
    assert.equal(
      adminPreviewAllowed(new Headers(), { NODE_ENV: "development" }),
      true,
    );
  });

  for (const override of [
    { MOVARO_AUTH_STAGING: undefined },
    { MOVARO_AUTH_STAGING: "false" },
    { AUTH_BASE_URL: "https://api.example.test" },
    { AUTH_WEB_ORIGIN: "http://web.example.test" },
    { AUTH_ADMIN_ORIGIN: "https://web.example.test:444" },
    { AUTH_ADMIN_ORIGIN: "https://admin.example.test/path" },
    { AUTH_PROXY_SECRET: undefined },
    { AUTH_PROXY_SECRET: "short" },
  ]) {
    it(`rejects invalid staging configuration ${JSON.stringify(override)}`, () => {
      const invalid = { ...env, ...override };
      assert.equal(protectedStagingConfigured(invalid), false);
      assert.equal(adminPreviewAllowed(assertion("192.0.2.1"), invalid), false);
    });
  }
});
