CREATE TABLE "profile_photo_scan" (
    "id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "continuation_token" TEXT,
    CONSTRAINT "profile_photo_scan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_photo_scan_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "profile_photo_scan_revision_check" CHECK ("revision" >= 0)
);

INSERT INTO "profile_photo_scan" ("id") VALUES (1);
