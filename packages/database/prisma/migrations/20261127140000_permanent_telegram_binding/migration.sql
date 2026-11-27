-- Public Telegram binding is permanent. Any future authorized data purge
-- needs a separate audited retention procedure.
CREATE FUNCTION "guard_permanent_telegram_binding"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."providerId" = 'telegram' THEN
            RAISE EXCEPTION 'Telegram binding is permanent'
                USING ERRCODE = '23514', CONSTRAINT = 'account_telegram_permanent';
        END IF;
        RETURN OLD;
    END IF;
    IF (OLD."providerId" = 'telegram' OR NEW."providerId" = 'telegram')
        AND (NEW.id IS DISTINCT FROM OLD.id
          OR NEW."userId" IS DISTINCT FROM OLD."userId"
          OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
          OR NEW."accountId" IS DISTINCT FROM OLD."accountId")
    THEN
        RAISE EXCEPTION 'Telegram binding is permanent'
            USING ERRCODE = '23514', CONSTRAINT = 'account_telegram_permanent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "account_guard_permanent_telegram_binding"
BEFORE DELETE OR UPDATE ON "account"
FOR EACH ROW EXECUTE FUNCTION "guard_permanent_telegram_binding"();
