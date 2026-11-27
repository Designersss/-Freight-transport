ALTER TABLE user_profiles
    ADD COLUMN birth_date DATE,
    ADD CONSTRAINT user_profiles_birth_date_check
        CHECK (birth_date IS NULL OR (birth_date >= DATE '0001-01-01'
            AND birth_date <= (created_at AT TIME ZONE 'UTC')::date));
