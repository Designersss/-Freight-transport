-- Greenfield email-first registration no longer stores pending credentials.
-- Never silently discard old preview data or make a prior draft eligible.
BEGIN;
LOCK TABLE "user" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "user" WHERE "registrationDraft" IS NOT NULL) THEN
        RAISE EXCEPTION 'Registration drafts exist; review isolated preview data before migration';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_telegram_binding"() RETURNS trigger
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
        AND NEW."linkSessionId" IS NULL AND NEW."linkRevision" IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM "account" a WHERE a."userId" = owner_record.id AND a."providerId" = 'credential'
        )
    THEN
        RETURN NEW;
    END IF;

    IF NOT owner_record."emailVerified" OR owner_record.email LIKE '%.invalid'
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

CREATE OR REPLACE FUNCTION "guard_admin_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."adminSession" THEN
        PERFORM u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
            WHERE u.id = NEW."userId" AND p.role = 'PLATFORM_ADMIN'
              AND p.status = 'ACTIVE' AND u."emailVerified"
              AND u.email NOT LIKE '%.invalid'
              AND NEW."telegramAccountId" IS NULL
            FOR UPDATE OF u, p;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid admin session'
                USING ERRCODE = '23514', CONSTRAINT = 'session_admin_scope_guard';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_email_registration() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner_email TEXT;
    profile JSONB;
BEGIN
    SELECT email INTO owner_email FROM "user"
      WHERE id = NEW."userId" AND "emailVerified"
        AND username IS NOT NULL
      FOR UPDATE;
    IF NOT FOUND OR NEW."providerId" <> 'credential'
       OR NEW.password IS NULL OR NEW."registrationProofHash" IS NULL
       OR NEW."registrationProfile" IS NULL
       OR NOT consume_registration_email_proof(NEW."registrationProofHash", owner_email) THEN
        RAISE EXCEPTION 'Invalid registration proof' USING ERRCODE = '23514';
    END IF;
    profile := NEW."registrationProfile"::jsonb;
    IF profile->>'role' IS NULL OR profile->>'role' NOT IN ('COMPANY_OWNER', 'DISPATCHER', 'DRIVER') THEN
        RAISE EXCEPTION 'Invalid registration role' USING ERRCODE = '23514';
    END IF;
    INSERT INTO user_profiles (user_id, first_name, last_name, role, company_name, birth_date)
      VALUES (NEW."userId", profile->>'firstName', profile->>'lastName',
        (profile->>'role')::user_role, profile->>'companyName', (profile->>'birthDate')::date);
    NEW."registrationProofHash" := NULL;
    NEW."registrationProfile" := NULL;
    RETURN NEW;
END;
$$;

ALTER TABLE "user" DROP CONSTRAINT "user_registration_draft_username_check",
    DROP COLUMN "registrationDraft" RESTRICT;
COMMIT;
