import type { Pool } from "pg";

// Keep this deployment contract in sync with auth migrations. The integration
// suite checks the manifest against the actual migration directories.
export const authMigrations = [
  "20261126030000_auth_foundation",
  "20261126040000_auth_mail_limits",
  "20261127060000_registration_draft_username",
  "20261127070000_username_change_cooldown",
  "20261127080000_profile_photo_key",
  "20261127090000_profile_photo_cleanup",
  "20261127100000_profile_photo_scan",
  "20261127110000_telegram_account_identity",
  "20261127120000_telegram_token_minimization",
  "20261127130000_telegram_link_fence",
  "20261127140000_permanent_telegram_binding",
  "20261127150000_pending_email_change",
  "20261127160000_email_change_auth_fence",
  "20261127170000_admin_session_scope",
  "20261127180000_account_deactivation_fence",
  "20261128000000_credential_login_fence",
  "20261128010000_credential_rotation_proof",
  "20261128020000_credential_lock_order",
  "20261128030000_registration_email_proof",
  "20261128040000_registration_finalize",
  "20261128050000_remove_registration_draft",
  "20261128060000_birth_date_validation",
  "20261128070000_admin_rate_limits",
] as const;

const columns = {
  user: [
    "id",
    "name",
    "email",
    "emailVerified",
    "image",
    "username",
    "username_changed_at",
    "telegramLinkRevision",
    "credentialRevision",
    "createdAt",
    "updatedAt",
  ],
  account: [
    "id",
    "accountId",
    "providerId",
    "userId",
    "accessToken",
    "refreshToken",
    "idToken",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt",
    "scope",
    "linkSessionId",
    "linkRevision",
    "registrationProofHash",
    "registrationProfile",
    "rotationUserId",
    "rotationEmail",
    "rotationRevision",
    "password",
    "createdAt",
    "updatedAt",
  ],
  session: [
    "id",
    "expiresAt",
    "token",
    "createdAt",
    "updatedAt",
    "ipAddress",
    "userAgent",
    "telegramAccountId",
    "emailLoginProof",
    "emailLoginRevision",
    "adminSession",
    "userId",
  ],
  verification: [
    "id",
    "identifier",
    "value",
    "resetEmail",
    "resetRevision",
    "expiresAt",
    "createdAt",
    "updatedAt",
  ],
  rateLimit: ["id", "key", "count", "lastRequest"],
  admin_rate_limits: ["id", "key", "count", "lastRequest"],
  user_profiles: [
    "user_id",
    "first_name",
    "last_name",
    "role",
    "status",
    "birth_date",
    "company_name",
    "photo_key",
    "created_at",
    "updated_at",
  ],
  pending_email_change: [
    "user_id",
    "session_id",
    "old_email",
    "new_email",
    "token_hash",
    "stage",
    "locale",
    "expires_at",
  ],
  registration_email_proofs: ["token_hash", "email", "expires_at"],
  auth_mail_rate_limits: ["key", "count", "expires_at"],
  profile_photo_cleanup: ["key", "owner_id", "available_at", "attempts"],
  profile_photo_scan: ["id", "revision", "continuation_token"],
};

const triggers = [
  [
    "account",
    "account_discard_telegram_tokens",
    "discard_telegram_oauth_tokens",
  ],
  ["account", "account_guard_telegram_binding", "guard_telegram_binding"],
  [
    "account",
    "account_guard_permanent_telegram_binding",
    "guard_permanent_telegram_binding",
  ],
  ["account", "account_fence_credential_rotation", "fence_credential_rotation"],
  [
    "account",
    "account_finalize_email_registration",
    "finalize_email_registration",
  ],
  ["session", "session_guard_telegram_login", "guard_telegram_login_session"],
  ["session", "session_guard_email_login", "guard_email_login_session"],
  ["session", "session_guard_admin_scope", "guard_admin_session"],
  ["session", "session_guard_account_status", "guard_session_account_status"],
  [
    "verification",
    "verification_guard_password_reset_email",
    "guard_password_reset_email",
  ],
  [
    "user_profiles",
    "user_profiles_birth_date_guard",
    "guard_profile_birth_date",
  ],
];

const uniqueIndexes = [
  ["user", "user_email_uidx"],
  ["user", "user_username_uidx"],
  ["account", "account_providerId_accountId_uidx"],
  ["account", "account_telegram_user_uidx"],
  ["session", "session_token_uidx"],
  ["rateLimit", "rateLimit_key_uidx"],
  ["admin_rate_limits", "admin_rate_limits_key_uidx"],
  ["user_profiles", "user_profiles_photo_key_uidx"],
  ["pending_email_change", "pending_email_change_token_hash_uidx"],
];

const constraints = [
  ["account", "account_registration_proof_ephemeral"],
  ["account", "account_rotation_proof_consumed"],
  ["account", "account_telegram_proof_consumed"],
  ["session", "session_email_login_proof_consumed"],
  ["session", "session_email_login_revision_consumed"],
  ["session", "session_telegram_account_fkey"],
  ["user_profiles", "user_profiles_birth_date_check"],
  ["user_profiles", "user_profiles_company_name_check"],
];

// Read only metadata and migration history. Do not repair schema, invoke
// business triggers, read credentials or change the shared pool's defaults.
export async function checkAuthSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed = true;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    const result = await client.query<{ ready: boolean }>(
      `WITH required_tables AS (
         SELECT key AS table_name, value AS fields,
                to_regclass(format('%I', key)) AS relation
         FROM jsonb_each($1::jsonb)
       )
       SELECT
         current_setting('session_replication_role') IN ('origin', 'local')
         AND NOT EXISTS (
           SELECT 1 FROM required_tables r
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.oid = r.relation AND c.relkind = 'r' AND n.nspname = 'public'
               AND has_table_privilege(c.oid, 'SELECT')
               AND has_table_privilege(c.oid, 'INSERT')
               AND has_table_privilege(c.oid, 'UPDATE')
               AND has_table_privilege(c.oid, 'DELETE')
           )
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(r.fields) AS field(name)
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = r.relation AND a.attname = field.name
                 AND a.attnum > 0 AND NOT a.attisdropped
             )
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS expected(name)
           WHERE NOT EXISTS (
             SELECT 1 FROM public._prisma_migrations m
             WHERE m.migration_name = expected.name
               AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM public._prisma_migrations
           WHERE finished_at IS NULL AND rolled_back_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements($3::jsonb) AS expected(item)
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_trigger t
             JOIN pg_proc f ON f.oid = t.tgfoid
             JOIN pg_namespace n ON n.oid = f.pronamespace
             WHERE t.tgrelid = to_regclass(format('%I', expected.item->>0))
               AND t.tgname = expected.item->>1
               AND f.proname = expected.item->>2 AND n.nspname = 'public'
               AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements($4::jsonb) AS expected(item)
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE i.indrelid = to_regclass(format('%I', expected.item->>0))
               AND c.relname = expected.item->>1
               AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements($5::jsonb) AS expected(item)
           WHERE NOT EXISTS (
             SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = to_regclass(format('%I', expected.item->>0))
               AND c.conname = expected.item->>1 AND c.convalidated
           )
         )
         AND to_regprocedure('public.consume_registration_email_proof(text,text)') IS NOT NULL
         AS ready`,
      [
        JSON.stringify(columns),
        authMigrations,
        JSON.stringify(triggers),
        JSON.stringify(uniqueIndexes),
        JSON.stringify(constraints),
      ],
    );
    if (result.rows[0]?.ready !== true)
      throw new Error("Auth database schema is not ready");
    await client.query("COMMIT");
    failed = false;
  } finally {
    // Destroy the connection on any failure, including a failed transaction.
    client.release(failed);
  }
}
