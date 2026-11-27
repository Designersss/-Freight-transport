ALTER TABLE "account"
    ADD COLUMN "registrationProofHash" TEXT,
    ADD COLUMN "registrationProfile" TEXT,
    ADD CONSTRAINT account_registration_proof_ephemeral
      CHECK ("registrationProofHash" IS NULL AND "registrationProfile" IS NULL);

-- Better Auth's raw pg Pool adapter runs signup in a real transaction.
-- Consume the proof and create the profile on credential INSERT; failure
-- rolls back the user, credential, profile and proof together.
CREATE FUNCTION finalize_email_registration() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    owner_email TEXT;
    profile JSONB;
BEGIN
    SELECT email INTO owner_email FROM "user"
      WHERE id = NEW."userId" AND "emailVerified"
        AND username IS NOT NULL AND "registrationDraft" IS NULL
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

CREATE TRIGGER account_finalize_email_registration
    BEFORE INSERT ON "account" FOR EACH ROW
    WHEN (NEW."registrationProofHash" IS NOT NULL OR NEW."registrationProfile" IS NOT NULL)
    EXECUTE FUNCTION finalize_email_registration();
