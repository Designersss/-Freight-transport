CREATE TABLE telegram_bot_requests (
    id UUID PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    deep_link_hash TEXT NOT NULL,
    intent TEXT NOT NULL,
    locale TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    display_code TEXT NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL,
    expires_at TIMESTAMPTZ(6) NOT NULL,
    telegram_user_id TEXT,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    link_user_id TEXT,
    link_session_id TEXT,
    link_revision INTEGER,
    CONSTRAINT telegram_bot_requests_hash_check CHECK (
        browser_hash ~ '^[0-9a-f]{64}$'
        AND deep_link_hash ~ '^[0-9a-f]{64}$'
        AND browser_hash <> deep_link_hash
    ),
    CONSTRAINT telegram_bot_requests_intent_check CHECK (
        intent IN ('login', 'register', 'link') AND locale IN ('ru', 'en')
    ),
    CONSTRAINT telegram_bot_requests_expiry_check CHECK (
        expires_at = created_at + interval '5 minutes'
    ),
    CONSTRAINT telegram_bot_requests_display_check CHECK (
        display_code ~ '^[0-9]{6}$'
    ),
    CONSTRAINT telegram_bot_requests_link_check CHECK (
        (intent = 'link' AND link_user_id IS NOT NULL AND link_session_id IS NOT NULL
            AND link_revision IS NOT NULL AND link_revision >= 0)
        OR (intent <> 'link' AND link_user_id IS NULL AND link_session_id IS NULL AND link_revision IS NULL)
    ),
    CONSTRAINT telegram_bot_requests_state_check CHECK (
        status IN ('pending', 'claimed', 'approved', 'rejected', 'cancelled', 'consumed')
        AND (
            (status IN ('claimed', 'approved') AND telegram_user_id IS NOT NULL)
            OR (status NOT IN ('claimed', 'approved') AND telegram_user_id IS NULL
                AND first_name IS NULL AND last_name IS NULL AND phone_number IS NULL)
        )
        AND (telegram_user_id IS NULL OR telegram_user_id ~ '^[1-9][0-9]{0,15}$')
        AND (first_name IS NULL OR (intent = 'register' AND char_length(first_name) BETWEEN 1 AND 128))
        AND (last_name IS NULL OR (intent = 'register' AND char_length(last_name) BETWEEN 1 AND 128))
        AND (phone_number IS NULL OR (intent = 'register' AND phone_number ~ '^\+[1-9][0-9]{1,14}$'))
        AND (status <> 'approved' OR intent <> 'register' OR phone_number IS NOT NULL)
    )
);

CREATE UNIQUE INDEX telegram_bot_requests_browser_uidx ON telegram_bot_requests (browser_hash);
CREATE UNIQUE INDEX telegram_bot_requests_deep_link_uidx ON telegram_bot_requests (deep_link_hash);
CREATE INDEX telegram_bot_requests_expiry_idx ON telegram_bot_requests (expires_at);
