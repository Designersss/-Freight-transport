ALTER TABLE "user" ADD COLUMN "telegramLinkRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "account" ADD COLUMN "linkSessionId" TEXT,
    ADD COLUMN "linkRevision" INTEGER;
ALTER TABLE "session" ADD COLUMN "telegramAccountId" TEXT,
    ADD CONSTRAINT "session_telegram_account_fkey"
      FOREIGN KEY ("telegramAccountId") REFERENCES "account"("id")
      ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE INDEX "session_telegram_account_idx" ON "session"("telegramAccountId");

-- The proof is supplied by the verified callback only, and is never retained.
ALTER TABLE "account" ADD CONSTRAINT "account_telegram_proof_consumed"
    CHECK ("linkSessionId" IS NULL AND "linkRevision" IS NULL);

CREATE FUNCTION "guard_telegram_binding"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    owner_record "user"%ROWTYPE;
BEGIN
    IF NEW."providerId" <> 'telegram' THEN
        RETURN NEW;
    END IF;
    SELECT * INTO owner_record FROM "user" WHERE id = NEW."userId" FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid Telegram binding' USING ERRCODE = '23514';
    END IF;

    IF NOT owner_record."emailVerified"
        AND owner_record.email = encode(sha256(convert_to(NEW."accountId", 'UTF8')), 'hex') || '@telegram.invalid'
        AND owner_record."registrationDraft" IS NULL
        AND NEW."linkSessionId" IS NULL AND NEW."linkRevision" IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM "account" a WHERE a."userId" = owner_record.id AND a."providerId" = 'credential'
        )
    THEN
        RETURN NEW;
    END IF;

    IF NOT owner_record."emailVerified" OR owner_record.email LIKE '%.invalid'
        OR owner_record."registrationDraft" IS NOT NULL
        OR NEW."linkSessionId" IS NULL
        OR NEW."linkRevision" IS DISTINCT FROM owner_record."telegramLinkRevision"
    THEN
        RAISE EXCEPTION 'Invalid Telegram binding' USING ERRCODE = '23514', CONSTRAINT = 'account_telegram_link_guard';
    END IF;

    PERFORM p.user_id FROM user_profiles p
        JOIN "session" s ON s."userId" = p.user_id
        JOIN "account" a ON a."userId" = p.user_id AND a."providerId" = 'credential'
        WHERE p.user_id = owner_record.id AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'
          AND s.id = NEW."linkSessionId" AND s."expiresAt" > clock_timestamp()
          AND s."createdAt" > clock_timestamp() - interval '10 minutes'
          AND s."telegramAccountId" IS NULL
          AND a.password IS NOT NULL AND a.password <> ''
        FOR UPDATE OF p, s, a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid Telegram binding' USING ERRCODE = '23514', CONSTRAINT = 'account_telegram_link_guard';
    END IF;

    UPDATE "user" SET "telegramLinkRevision" = "telegramLinkRevision" + 1 WHERE id = owner_record.id;
    NEW."linkSessionId" := NULL;
    NEW."linkRevision" := NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "account_guard_telegram_binding"
BEFORE INSERT ON "account"
FOR EACH ROW EXECUTE FUNCTION "guard_telegram_binding"();

-- Verify the account belongs to the same user; FK fences deletion/replacement.
CREATE FUNCTION "guard_telegram_login_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."telegramAccountId" IS NOT NULL THEN
        PERFORM id FROM "account"
            WHERE id = NEW."telegramAccountId" AND "userId" = NEW."userId"
              AND "providerId" = 'telegram'
            FOR KEY SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid Telegram session' USING ERRCODE = '23514', CONSTRAINT = 'session_telegram_owner_guard';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "session_guard_telegram_login"
BEFORE INSERT OR UPDATE OF "telegramAccountId", "userId" ON "session"
FOR EACH ROW EXECUTE FUNCTION "guard_telegram_login_session"();
