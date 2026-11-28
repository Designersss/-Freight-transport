ALTER TABLE "verification" ADD COLUMN "resetRevision" INTEGER
    CHECK ("resetRevision" IS NULL OR "resetRevision" >= 0);
ALTER TABLE "account" ADD COLUMN "rotationUserId" TEXT;
ALTER TABLE "account" ADD COLUMN "rotationEmail" TEXT;
ALTER TABLE "account" ADD COLUMN "rotationRevision" INTEGER;
ALTER TABLE "account" ADD CONSTRAINT "account_rotation_proof_consumed"
    CHECK ("rotationUserId" IS NULL AND "rotationEmail" IS NULL AND "rotationRevision" IS NULL);

-- A reset link belongs to the revision captured before token issuance.
-- Existing links without a revision are not valid for password rotation.
CREATE OR REPLACE FUNCTION "guard_password_reset_email"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.identifier LIKE 'reset-password:%' THEN
            PERFORM id FROM "user" WHERE id = OLD.value FOR UPDATE;
        END IF;
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

-- Compare the original revision, not the revision read after hashing.
-- The owner update, password write and session revocation roll back together.
DROP TRIGGER "account_fence_credential_rotation" ON "account";

CREATE OR REPLACE FUNCTION "fence_credential_rotation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."rotationUserId" IS DISTINCT FROM OLD."userId"
        OR NEW.password IS NULL OR NEW."providerId" <> 'credential'
        OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
        RAISE EXCEPTION 'Invalid credential rotation'
            USING ERRCODE = '23514', CONSTRAINT = 'account_credential_rotation_guard';
    END IF;

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

CREATE TRIGGER "account_fence_credential_rotation"
BEFORE UPDATE OF password ON "account"
FOR EACH ROW
WHEN (OLD."providerId" = 'credential' AND OLD.password IS DISTINCT FROM NEW.password)
EXECUTE FUNCTION "fence_credential_rotation"();
