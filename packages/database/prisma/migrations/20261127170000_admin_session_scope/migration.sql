ALTER TABLE "session" ADD COLUMN "adminSession" BOOLEAN NOT NULL DEFAULT false;

CREATE FUNCTION "guard_admin_session"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."adminSession" THEN
        PERFORM u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
            WHERE u.id = NEW."userId" AND p.role = 'PLATFORM_ADMIN'
              AND p.status = 'ACTIVE' AND u."emailVerified"
              AND u.email NOT LIKE '%.invalid' AND u."registrationDraft" IS NULL
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

CREATE TRIGGER "session_guard_admin_scope"
BEFORE INSERT OR UPDATE OF "adminSession", "userId" ON "session"
FOR EACH ROW EXECUTE FUNCTION "guard_admin_session"();
