CREATE TABLE "pending_email_change" (
    "user_id" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "session_id" TEXT NOT NULL REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "old_email" TEXT NOT NULL,
    "new_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "pending_email_change_stage_check" CHECK ("stage" IN ('old', 'new')),
    CONSTRAINT "pending_email_change_locale_check" CHECK ("locale" IN ('ru', 'en')),
    CONSTRAINT "pending_email_change_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "pending_email_change_address_check" CHECK (
        "old_email" <> "new_email"
        AND "old_email" = lower("old_email")
        AND "new_email" = lower("new_email")
        AND "old_email" NOT LIKE '%.invalid'
        AND "new_email" NOT LIKE '%.invalid'
    )
);
CREATE UNIQUE INDEX "pending_email_change_token_hash_uidx" ON "pending_email_change"("token_hash");
CREATE INDEX "pending_email_change_session_idx" ON "pending_email_change"("session_id");
