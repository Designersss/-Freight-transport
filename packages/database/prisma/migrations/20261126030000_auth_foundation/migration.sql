CREATE TYPE "user_role" AS ENUM ('PLATFORM_ADMIN', 'COMPANY_OWNER', 'DISPATCHER', 'DRIVER');
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DEACTIVATED');

CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_email_normalized_check" CHECK ("email" = lower("email")),
    CONSTRAINT "user_internal_email_unverified_check" CHECK ("email" NOT LIKE '%@telegram.invalid' OR NOT "emailVerified")
);
CREATE UNIQUE INDEX "user_email_uidx" ON "user"("email");

CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(6),
    "refreshTokenExpiresAt" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_providerId_accountId_uidx" ON "account"("providerId", "accountId");
CREATE INDEX "account_userId_idx" ON "account"("userId");

CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "session_token_uidx" ON "session"("token");
CREATE INDEX "session_userId_idx" ON "session"("userId");

CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,
    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rateLimit_key_uidx" ON "rateLimit"("key");

CREATE TABLE "user_profiles" (
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "birth_date" DATE NOT NULL,
    "company_name" TEXT,
    "photo_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "user_profiles_name_check" CHECK (btrim("first_name") <> '' AND btrim("last_name") <> ''),
    CONSTRAINT "user_profiles_birth_date_check" CHECK ("birth_date" >= DATE '0001-01-01' AND "birth_date" <= ("created_at" AT TIME ZONE 'UTC')::date),
    CONSTRAINT "user_profiles_company_name_check" CHECK (("role" = 'COMPANY_OWNER' AND "company_name" IS NOT NULL AND btrim("company_name") <> '' AND char_length("company_name") <= 200) OR ("role" <> 'COMPANY_OWNER' AND "company_name" IS NULL))
);
