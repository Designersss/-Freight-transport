-- The accepted birth date depends on the UTC day of the write, not
-- the day the profile was created. Keep the static range in a CHECK and
-- validate the moving upper bound in a trigger, not a mutable CHECK.
BEGIN;

LOCK TABLE user_profiles IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM user_profiles
        WHERE birth_date > (clock_timestamp() AT TIME ZONE 'UTC')::date
    ) THEN
        RAISE EXCEPTION 'Existing profile has a future birth date';
    END IF;
END;
$$;

ALTER TABLE user_profiles
    DROP CONSTRAINT user_profiles_birth_date_check,
    ADD CONSTRAINT user_profiles_birth_date_check
        CHECK (birth_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');

CREATE FUNCTION guard_profile_birth_date() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.birth_date > (clock_timestamp() AT TIME ZONE 'UTC')::date THEN
        RAISE EXCEPTION 'Birth date cannot be in the future'
            USING ERRCODE = '23514', CONSTRAINT = 'user_profiles_birth_date_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_birth_date_guard
    BEFORE INSERT OR UPDATE OF birth_date ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION guard_profile_birth_date();

COMMIT;
