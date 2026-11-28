ALTER TABLE user_profiles ADD COLUMN telegram_phone_number TEXT,
    ADD CONSTRAINT user_profiles_telegram_phone_check CHECK (
        telegram_phone_number IS NULL OR (
            telegram_phone_number ~ '^[+][1-9][0-9]{1,14}$'
            AND role <> 'PLATFORM_ADMIN'
        )
    );
