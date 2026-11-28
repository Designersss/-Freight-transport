-- Prevent a delayed session INSERT from reviving a deactivated account.
-- The owner lock is shared with the deactivation transaction.
CREATE FUNCTION "guard_session_account_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM "user" WHERE id = NEW."userId" FOR UPDATE;
    PERFORM user_id FROM user_profiles
        WHERE user_id = NEW."userId" AND status = 'DEACTIVATED'
        FOR UPDATE;
    IF FOUND THEN
        RAISE EXCEPTION 'Inactive account'
            USING ERRCODE = '23514', CONSTRAINT = 'session_active_account_guard';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "session_guard_account_status"
BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION "guard_session_account_status"();

-- Preserve the existing email fence, adding a status/role check after
-- acquiring the owner lock. DELETE remains allowed for revocation/cleanup.
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
