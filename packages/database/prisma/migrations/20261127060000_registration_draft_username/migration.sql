ALTER TABLE "user"
    ADD COLUMN "username" TEXT,
    ADD COLUMN "registrationDraft" TEXT,
    ADD CONSTRAINT "user_username_format_check"
        CHECK ("username" IS NULL OR ("username" COLLATE "C" ~ '^[a-z][a-z0-9_]{2,31}$' AND "username" NOT IN ('admin', 'support', 'movaro'))),
    ADD CONSTRAINT "user_registration_draft_username_check"
        CHECK ("registrationDraft" IS NULL OR "username" IS NOT NULL);

CREATE UNIQUE INDEX "user_username_uidx" ON "user"("username");
