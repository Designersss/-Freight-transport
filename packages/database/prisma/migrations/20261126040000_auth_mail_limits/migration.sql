CREATE TABLE "auth_mail_rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL CHECK ("count" > 0),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "auth_mail_rate_limits_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "auth_mail_rate_limits_expiry_idx" ON "auth_mail_rate_limits"("expires_at");
