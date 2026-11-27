CREATE TABLE "profile_photo_cleanup" (
    "key" TEXT NOT NULL,
    "owner_id" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "profile_photo_cleanup_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "profile_photo_cleanup_key_check"
        CHECK ("key" ~ '^profile-photos/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "profile_photo_cleanup_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "profile_photo_cleanup_owner_check" CHECK ("owner_id" IS NULL OR "attempts" = 0)
);

CREATE INDEX "profile_photo_cleanup_available_idx" ON "profile_photo_cleanup"("available_at", "key");
