-- This receipt reports completion only. It cannot authorize a session.
CREATE TABLE telegram_registration_completions (
    id UUID PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL,
    expires_at TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT telegram_registration_completions_hash_check
        CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT telegram_registration_completions_expiry_check
        CHECK (expires_at = created_at + interval '5 minutes')
);
CREATE INDEX telegram_registration_completions_expiry_idx
    ON telegram_registration_completions (expires_at);
