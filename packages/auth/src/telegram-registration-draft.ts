import type { Pool } from "pg";
import { z } from "zod";
import {
  birthDateInput,
  profileSettingsInput,
  publicRole,
  usernameInput,
} from "./contracts.js";
import {
  privateTelegramActor,
  type TelegramBotActor,
  telegramBotCapabilityHash,
} from "./telegram-bot-requests.js";

const channelInput = z.enum(["web", "bot"]);
type Channel = z.infer<typeof channelInput>;

type DraftAccess =
  | { channel: "web"; browserCapability: unknown }
  | { channel: "bot"; actor: TelegramBotActor };

const editInput = z.strictObject({
  action: z.literal("edit"),
  revision: z.number().int().min(0).max(2_147_483_646),
  firstName: profileSettingsInput.shape.firstName.optional(),
  lastName: profileSettingsInput.shape.lastName.optional(),
  role: publicRole.optional(),
  birthDate: birthDateInput.optional(),
  companyName: profileSettingsInput.shape.firstName.nullable().optional(),
  username: usernameInput.optional(),
});
const mutationInput = z.discriminatedUnion("action", [
  editInput,
  z.strictObject({
    action: z.literal("switch"),
    revision: z.number().int().min(0).max(2_147_483_646),
    channel: channelInput,
  }),
]);

interface DraftView {
  id: string;
  channel: Channel;
  locale: "ru" | "en";
  revision: number;
  expiresAt: Date;
  firstName: string | null;
  lastName: string | null;
  role: z.infer<typeof publicRole> | null;
  birthDate: string | null;
  companyName: string | null;
  username: string | null;
}

// Do not return phone, Telegram ID or capability hashes to either client.
const fields = `id, channel, locale, revision, expires_at AS "expiresAt",
  first_name AS "firstName", last_name AS "lastName", role,
  birth_date::text AS "birthDate", company_name AS "companyName", username`;

function ownership(access: DraftAccess) {
  if (access.channel === "web") {
    const hash = telegramBotCapabilityHash(access.browserCapability);
    return hash ? { hash, actorId: null } : null;
  }
  return privateTelegramActor(access.actor)
    ? { hash: null, actorId: access.actor.userId }
    : null;
}

// Internal only. The future authenticated bot API must establish the actor,
// obtain an explicit channel choice and close the relay risk before mounting.
export async function beginTelegramRegistrationDraft(
  pool: Pool,
  requestId: string,
  actor: TelegramBotActor,
  channel: unknown,
): Promise<string | null> {
  const selected = channelInput.safeParse(channel);
  if (!selected.success || !privateTelegramActor(actor)) return null;
  const result = await pool.query<{ id: string }>(
    `WITH grant AS (
       SELECT r.id, r.browser_hash, r.telegram_user_id, r.locale,
         r.phone_number, r.first_name, r.last_name
       FROM telegram_bot_requests r
       WHERE r.id::text = $1 AND r.telegram_user_id = $2
         AND r.intent = 'register' AND r.status = 'approved'
         AND r.expires_at > clock_timestamp() AND r.phone_number IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "account" a WHERE a."providerId" = 'telegram'
             AND a."accountId" = 'bot:' || r.telegram_user_id
         )
       FOR UPDATE OF r
     ), inserted AS (
       INSERT INTO telegram_registration_drafts (
         id, browser_hash, telegram_user_id, locale, channel, phone_number,
         first_name, last_name, created_at, expires_at
       )
       SELECT id, browser_hash, telegram_user_id, locale, $3, phone_number,
         first_name, last_name, statement_timestamp(),
         statement_timestamp() + interval '30 minutes'
       FROM grant ON CONFLICT DO NOTHING RETURNING id
     )
     UPDATE telegram_bot_requests r SET status = 'consumed',
       telegram_user_id = NULL, first_name = NULL, last_name = NULL,
       phone_number = NULL
     FROM inserted i WHERE r.id = i.id RETURNING r.id`,
    [requestId, actor.userId, selected.data],
  );
  return result.rows[0]?.id ?? null;
}

const owned = `id::text = $1 AND (browser_hash = $2 OR telegram_user_id = $3)
  AND expires_at > clock_timestamp()`;

export async function readTelegramRegistrationDraft(
  pool: Pool,
  id: string,
  access: DraftAccess,
): Promise<DraftView | null> {
  const owner = ownership(access);
  if (!owner) return null;
  const result = await pool.query<DraftView>(
    `SELECT ${fields} FROM telegram_registration_drafts WHERE ${owned}`,
    [id, owner.hash, owner.actorId],
  );
  return result.rows[0] ?? null;
}

// Optimistic revision prevents stale callbacks or tabs from overwriting the
// latest values. Reads never refresh the timeout. The inactive channel may
// explicitly switch, but cannot edit without switching first.
export async function updateTelegramRegistrationDraft(
  pool: Pool,
  id: string,
  access: DraftAccess,
  payload: unknown,
): Promise<DraftView | null> {
  const owner = ownership(access);
  const parsed = mutationInput.safeParse(payload);
  if (!owner || !parsed.success) return null;
  const change = parsed.data;
  if (change.action === "switch") {
    const result = await pool.query<DraftView>(
      `UPDATE telegram_registration_drafts SET channel = $5,
         revision = revision + 1,
         expires_at = LEAST(created_at + interval '2 hours',
           clock_timestamp() + interval '30 minutes')
       WHERE ${owned} AND revision = $4 AND channel <> $5
       RETURNING ${fields}`,
      [id, owner.hash, owner.actorId, change.revision, change.channel],
    );
    return result.rows[0] ?? null;
  }
  const { firstName, lastName, role, birthDate, companyName, username } = change;
  if (
    firstName === undefined &&
    lastName === undefined &&
    role === undefined &&
    birthDate === undefined &&
    companyName === undefined &&
    username === undefined
  )
    return null;
  const result = await pool.query<DraftView>(
    `UPDATE telegram_registration_drafts SET
       first_name = COALESCE($6, first_name),
       last_name = COALESCE($7, last_name),
       role = COALESCE($8, role),
       birth_date = COALESCE($9::date, birth_date),
       company_name = CASE
         WHEN COALESCE($8, role) IS DISTINCT FROM 'COMPANY_OWNER' THEN NULL
         WHEN $10::boolean THEN $11 ELSE company_name END,
       username = COALESCE($12, username), revision = revision + 1,
       expires_at = LEAST(created_at + interval '2 hours',
         clock_timestamp() + interval '30 minutes')
     WHERE ${owned} AND revision = $4 AND channel = $5
       AND ($11::text IS NULL OR COALESCE($8, role) = 'COMPANY_OWNER')
     RETURNING ${fields}`,
    [
      id,
      owner.hash,
      owner.actorId,
      change.revision,
      access.channel,
      firstName ?? null,
      lastName ?? null,
      role ?? null,
      birthDate ?? null,
      companyName !== undefined,
      companyName ?? null,
      username ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function deleteExpiredTelegramRegistrationDrafts(
  pool: Pool,
): Promise<number> {
  const result = await pool.query(
    `WITH expired AS (
       SELECT id FROM telegram_registration_drafts
       WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM telegram_registration_drafts d USING expired e
     WHERE d.id = e.id AND d.expires_at <= clock_timestamp()`,
  );
  return result.rowCount ?? 0;
}
