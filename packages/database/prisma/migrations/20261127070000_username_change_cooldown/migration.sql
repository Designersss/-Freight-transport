ALTER TABLE "user"
    ADD COLUMN "username_changed_at" TIMESTAMPTZ(6),
    ADD CONSTRAINT "user_username_changed_at_check"
        CHECK ("username_changed_at" IS NULL OR "username" IS NOT NULL);
