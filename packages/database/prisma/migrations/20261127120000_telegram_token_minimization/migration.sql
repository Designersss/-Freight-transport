-- Telegram OAuth is used only to establish identity. Do not retain provider
-- credentials that are not needed for subsequent MOVARO sessions.
CREATE FUNCTION "discard_telegram_oauth_tokens"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."providerId" = 'telegram' THEN
        NEW."accessToken" := NULL;
        NEW."refreshToken" := NULL;
        NEW."idToken" := NULL;
        NEW."accessTokenExpiresAt" := NULL;
        NEW."refreshTokenExpiresAt" := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "account_discard_telegram_tokens"
BEFORE INSERT OR UPDATE ON "account"
FOR EACH ROW EXECUTE FUNCTION "discard_telegram_oauth_tokens"();
