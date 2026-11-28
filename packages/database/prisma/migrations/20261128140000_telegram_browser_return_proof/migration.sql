ALTER TABLE telegram_bot_requests
    ADD COLUMN return_hash TEXT,
    ADD CONSTRAINT telegram_bot_requests_return_hash_check CHECK (
        return_hash IS NULL OR (
            status = 'claimed'
            AND return_hash ~ '^[0-9a-f]{64}$'
            AND return_hash <> browser_hash
            AND return_hash <> deep_link_hash
        )
    );

-- Outstanding approvals from the pre-return-proof implementation must
-- never authorize a browser. Fresh requests use the new two-sided proof.
UPDATE telegram_bot_requests
SET status = 'cancelled', telegram_user_id = NULL,
    first_name = NULL, last_name = NULL, phone_number = NULL
WHERE status IN ('pending', 'claimed', 'approved');
