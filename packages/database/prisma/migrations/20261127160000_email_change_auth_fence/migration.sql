ALTER TABLE "verification" ADD COLUMN "resetEmail" TEXT;
ALTER TABLE "session" ADD COLUMN "emailLoginProof" TEXT;

ALTER TABLE "session" ADD CONSTRAINT "session_email_login_proof_consumed"
    CHECK ("emailLoginProof" IS NULL);

-- Better Auth's reset consumes the verification and changes the credential
-- in one transaction on PostgreSQL. Serialize consumption and issuance with
-- the same user row used by the email change transaction.
CREATE FUNCTION "guard_password_reset_email"() RETURNS trigger
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
            FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid password reset destination'
                USING ERRCODE = '23514', CONSTRAINT = 'verification_reset_email_guard';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "verification_guard_password_reset_email"
BEFORE INSERT OR UPDATE OR DELETE ON "verification"
FOR EACH ROW EXECUTE FUNCTION "guard_password_reset_email"();

-- The sign-in hook supplies the email that was actually used to authenticate.
-- The proof is consumed by the INSERT trigger, not stored in the session.
CREATE FUNCTION "guard_email_login_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."emailLoginProof" IS NOT NULL THEN
        PERFORM id FROM "user"
            WHERE id = NEW."userId" AND email = NEW."emailLoginProof"
              AND "emailVerified" AND email NOT LIKE '%.invalid'
            FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Invalid email session'
                USING ERRCODE = '23514', CONSTRAINT = 'session_email_login_guard';
        END IF;
        NEW."emailLoginProof" := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "session_guard_email_login"
BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION "guard_email_login_session"();
