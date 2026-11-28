ALTER TABLE "session"
    ADD COLUMN "telegramBotRequestId" TEXT,
    ADD COLUMN "telegramBotBrowserHash" TEXT,
    ADD CONSTRAINT session_telegram_bot_proof_consumed
      CHECK ("telegramBotRequestId" IS NULL AND "telegramBotBrowserHash" IS NULL);

-- Existing session_guard_account_status acquires the owner lock first.
-- Consuming the grant is part of the session INSERT, not a prior commit.
CREATE FUNCTION guard_telegram_bot_session() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    subject TEXT;
BEGIN
    SELECT "accountId" INTO subject FROM "account"
      WHERE id = NEW."telegramAccountId" AND "userId" = NEW."userId"
        AND "providerId" = 'telegram' AND "accountId" LIKE 'bot:%';

    IF subject IS NULL AND NEW."telegramBotRequestId" IS NULL
       AND NEW."telegramBotBrowserHash" IS NULL THEN
        RETURN NEW;
    END IF;

    IF subject IS NULL OR NEW."adminSession"
       OR NEW."telegramBotRequestId" IS NULL
       OR NEW."telegramBotBrowserHash" IS NULL THEN
        RAISE EXCEPTION 'Invalid bot session proof'
            USING ERRCODE = '23514', CONSTRAINT = 'session_telegram_bot_guard';
    END IF;

    -- Recheck complete public account under the owner lock. An unfinished
    -- registration, admin, or deactivated account cannot use login intent.
    PERFORM u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = NEW."userId" AND p.status = 'ACTIVE'
        AND p.role <> 'PLATFORM_ADMIN' AND u.username IS NOT NULL
        AND ((u."emailVerified" AND u.email NOT LIKE '%.invalid')
          OR (NOT u."emailVerified"
            AND u.email = encode(sha256(convert_to(subject, 'UTF8')), 'hex') || '@telegram.invalid'
            AND NOT EXISTS (SELECT 1 FROM "account" c
              WHERE c."userId" = u.id AND c."providerId" = 'credential')))
      FOR UPDATE OF p;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid bot session proof'
            USING ERRCODE = '23514', CONSTRAINT = 'session_telegram_bot_guard';
    END IF;

    UPDATE telegram_bot_requests SET status = 'consumed',
      telegram_user_id = NULL, first_name = NULL, last_name = NULL, phone_number = NULL
      WHERE id::text = NEW."telegramBotRequestId"
        AND browser_hash = NEW."telegramBotBrowserHash"
        AND intent = 'login' AND status = 'approved'
        AND expires_at > clock_timestamp()
        AND 'bot:' || telegram_user_id = subject;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid bot session proof'
            USING ERRCODE = '23514', CONSTRAINT = 'session_telegram_bot_guard';
    END IF;
    NEW."telegramBotRequestId" := NULL;
    NEW."telegramBotBrowserHash" := NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER session_guard_bot_login
BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION guard_telegram_bot_session();
