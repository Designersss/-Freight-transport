CREATE TABLE telegram_registration_drafts (
    id UUID PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    locale TEXT NOT NULL,
    channel TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL,
    expires_at TIMESTAMPTZ(6) NOT NULL,
    phone_number TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    role TEXT,
    birth_date DATE,
    company_name TEXT,
    username TEXT,
    CONSTRAINT telegram_registration_drafts_identity_check CHECK (
        browser_hash ~ '^[0-9a-f]{64}$'
        AND telegram_user_id ~ '^[1-9][0-9]{0,15}$'
        AND phone_number ~ '^[+][1-9][0-9]{1,14}$'
    ),
    CONSTRAINT telegram_registration_drafts_state_check CHECK (
        locale IN ('ru', 'en') AND channel IN ('web', 'bot') AND revision >= 0
        AND expires_at > created_at AND expires_at <= created_at + interval '2 hours'
    ),
    CONSTRAINT telegram_registration_drafts_profile_check CHECK (
        (role IS NULL OR role IN ('COMPANY_OWNER', 'DISPATCHER', 'DRIVER'))
        AND (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 200)
        AND (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 200)
        AND (company_name IS NULL OR (role IS NOT NULL AND role = 'COMPANY_OWNER'
            AND char_length(company_name) BETWEEN 1 AND 200))
        AND (username IS NULL OR (username ~ '^[a-z][a-z0-9_]{2,31}$'
            AND username NOT IN ('admin', 'support', 'movaro')))
    )
);
CREATE UNIQUE INDEX telegram_registration_drafts_browser_uidx ON telegram_registration_drafts (browser_hash);
CREATE UNIQUE INDEX telegram_registration_drafts_actor_uidx ON telegram_registration_drafts (telegram_user_id);
CREATE INDEX telegram_registration_drafts_expiry_idx ON telegram_registration_drafts (expires_at);
