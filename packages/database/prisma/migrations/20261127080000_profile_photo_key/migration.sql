ALTER TABLE "user_profiles"
    ADD CONSTRAINT "user_profiles_photo_key_check"
        CHECK ("photo_key" IS NULL OR "photo_key" ~ '^profile-photos/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

CREATE UNIQUE INDEX "user_profiles_photo_key_uidx" ON "user_profiles"("photo_key");
