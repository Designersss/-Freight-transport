-- Separate Better Auth rate-limit policies for public and Admin endpoints.
-- No account, session or existing rate-limit rows are changed.
BEGIN;

CREATE TABLE admin_rate_limits (
    id TEXT NOT NULL,
    key TEXT NOT NULL,
    count INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,
    CONSTRAINT admin_rate_limits_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX admin_rate_limits_key_uidx ON admin_rate_limits(key);

COMMIT;
