-- A locator is not a session grant. It is retained only with the request,
-- including after the draft has been consumed into a completion receipt.
ALTER TABLE telegram_bot_requests
    ADD COLUMN registration_draft_id UUID,
    ADD CONSTRAINT telegram_bot_requests_registration_recovery_check CHECK (
        registration_draft_id IS NULL OR (
            intent = 'register' AND status = 'consumed'
        )
    );
