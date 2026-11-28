ALTER TABLE "user" ADD COLUMN "credentialRevision" INTEGER NOT NULL DEFAULT 0
    CHECK ("credentialRevision" >= 0);
ALTER TABLE "session" ADD COLUMN "emailLoginRevision" INTEGER;
ALTER TABLE "session" ADD CONSTRAINT "session_email_login_revision_consumed"
    CHECK ("emailLoginRevision" IS NULL);

-- Serialize the proof of password authentication with credential rotation.
CREATE OR REPLACE FUNCTION "guard_email_login_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."emailLoginProof" IS NOT NULL OR NEW."emailLoginRevision" IS NOT NULL THEN
        PERFORM id FROM "user"
            WHERE id = NEW."userId" AND email = NEW."emailLoginProof"
              AND "emailVerified" AND email NOT LIKE '%.invalid'
              AND "credentialRevision" = NEW."emailLoginRevision"
            FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid email session'
                USING ERRCODE = '23514', CONSTRAINT = 'session_email_login_guard';
        END IF;
        NEW."emailLoginProof" := NULL;
        NEW."emailLoginRevision" := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Better Auth revokes sessions before updating the credential. Revoke again
-- under the owner lock to cover sessions inserted between those statements.
-- Its replacement session (change-password) is created after this trigger.
CREATE FUNCTION "fence_credential_rotation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "user" SET "credentialRevision" = "credentialRevision" + 1
        WHERE id = NEW."userId";
    DELETE FROM "session" WHERE "userId" = NEW."userId";
    RETURN NEW;
END;
$$;

CREATE TRIGGER "account_fence_credential_rotation"
AFTER UPDATE OF password ON "account"
FOR EACH ROW
WHEN (OLD."providerId" = 'credential' AND OLD.password IS DISTINCT FROM NEW.password)
EXECUTE FUNCTION "fence_credential_rotation"();
