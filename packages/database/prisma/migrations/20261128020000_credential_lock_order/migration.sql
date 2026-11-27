-- Reset token deletion does not authorize rotation. Only the revision fence
-- does, inside the same transaction. Avoid taking owner locks during cleanup.
CREATE OR REPLACE FUNCTION "guard_password_reset_email"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Consumption and cleanup need no owner lock: the subsequent
        -- credential update compares the original revision atomically.
        RETURN OLD;
    END IF;

    IF NEW.identifier LIKE 'reset-password:%' THEN
        PERFORM id FROM "user"
            WHERE id = NEW.value AND email = NEW."resetEmail"
              AND email NOT LIKE '%.invalid'
              AND "credentialRevision" = NEW."resetRevision"
            FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid password reset destination'
                USING ERRCODE = '23514', CONSTRAINT = 'verification_reset_email_guard';
        END IF;
        PERFORM user_id FROM user_profiles
            WHERE user_id = NEW.value
              AND (status <> 'ACTIVE' OR role = 'PLATFORM_ADMIN')
            FOR UPDATE;
        IF FOUND THEN
            RAISE EXCEPTION 'Invalid password reset destination'
                USING ERRCODE = '23514', CONSTRAINT = 'verification_reset_email_guard';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Fail closed on owner contention instead of waiting in reversed lock order.
CREATE OR REPLACE FUNCTION "fence_credential_rotation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."rotationUserId" IS DISTINCT FROM OLD."userId"
        OR NEW.password IS NULL OR NEW."providerId" <> 'credential'
        OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
        RAISE EXCEPTION 'Invalid credential rotation'
            USING ERRCODE = '23514', CONSTRAINT = 'account_credential_rotation_guard';
    END IF;

    -- Better Auth may already hold session and verification row locks.
    -- Never wait for the owner while holding those rows: a concurrent
    -- deactivation/email change may hold the owner and need those rows.
    PERFORM id FROM "user" WHERE id = OLD."userId" FOR UPDATE NOWAIT;
    UPDATE "user" SET "credentialRevision" = "credentialRevision" + 1
        WHERE id = OLD."userId" AND email = NEW."rotationEmail"
          AND email NOT LIKE '%.invalid'
          AND "credentialRevision" = NEW."rotationRevision";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid credential rotation'
            USING ERRCODE = '23514', CONSTRAINT = 'account_credential_rotation_guard';
    END IF;
    PERFORM user_id FROM user_profiles
        WHERE user_id = OLD."userId"
          AND (status <> 'ACTIVE' OR role = 'PLATFORM_ADMIN')
        FOR UPDATE;
    IF FOUND THEN
        RAISE EXCEPTION 'Invalid credential rotation'
            USING ERRCODE = '23514', CONSTRAINT = 'account_credential_rotation_guard';
    END IF;
    DELETE FROM "session" WHERE "userId" = OLD."userId";

    NEW."rotationUserId" := NULL;
    NEW."rotationEmail" := NULL;
    NEW."rotationRevision" := NULL;
    RETURN NEW;
END;
$$;

