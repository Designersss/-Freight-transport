import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";
import type { AuthConfig } from "./config.js";
import { usernameInput, usernameRequest } from "./contracts.js";
import { reserveUsernameRequest } from "./mail-rate-limit.js";
import { usernameOwner } from "./registration.js";

const cyrillic: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function latinName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => cyrillic[letter] ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function usernameCandidates(firstName: string, lastName: string): string[] {
  const raw = [latinName(firstName), latinName(lastName)]
    .filter(Boolean)
    .join("_")
    .slice(0, 32);
  const base = usernameInput.safeParse(raw).success ? raw : "user";
  const candidates = [base];
  for (let number = 2; number <= 10; number++) {
    const suffix = String(number);
    candidates.push(base.slice(0, 32 - suffix.length) + suffix);
  }
  for (let index = 0; index < 3; index++) {
    const suffix = randomBytes(4).toString("hex");
    candidates.push(`${base.slice(0, 23)}_${suffix}`);
  }
  return candidates;
}

async function suggestUsername(
  pool: Pool,
  firstName: string,
  lastName: string,
) {
  const candidates = usernameCandidates(firstName, lastName);
  const result = await pool.query<{ username: string }>(
    'SELECT username FROM "user" WHERE username = ANY($1::text[])',
    [candidates],
  );
  const taken = new Set(result.rows.map((row) => row.username));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

export async function handleUsername(
  request: Request,
  config: AuthConfig,
  pool: Pool,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    new URL(request.url).search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");
  const ip = request.headers.get("x-movaro-client-ip");
  if (!ip || !isIP(ip)) return fail(400, "INVALID_REQUEST");
  const input = usernameRequest.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) return fail(400, "INVALID_REQUEST");

  try {
    const retry = await reserveUsernameRequest(pool, config.AUTH_SECRET, ip);
    if (retry !== null) {
      headers.set("retry-after", String(retry));
      return fail(429, "RATE_LIMITED");
    }
    if (input.data.action === "check") {
      const owner = await usernameOwner(pool, input.data.username);
      return Response.json({ available: owner === null }, { headers });
    }
    const username = await suggestUsername(
      pool,
      input.data.firstName,
      input.data.lastName,
    );
    if (!username) return fail(503, "AUTH_REQUEST_FAILED");
    return Response.json({ username }, { headers });
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
