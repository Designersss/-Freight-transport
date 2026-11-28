ALTER TABLE telegram_registration_drafts
    ALTER COLUMN browser_hash DROP NOT NULL,
    DROP CONSTRAINT telegram_registration_drafts_identity_check,
    ADD CONSTRAINT telegram_registration_drafts_identity_check CHECK (
        (browser_hash IS NULL OR browser_hash ~ '^[0-9a-f]{64}$')
        AND (channel <> 'web' OR browser_hash IS NOT NULL)
        AND telegram_user_id ~ '^[1-9][0-9]{0,15}$'
        AND phone_number ~ '^[+][1-9][0-9]{1,14}$'
    );
