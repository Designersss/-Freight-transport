ALTER TABLE "user_profiles"
    ADD COLUMN "company_name" TEXT,
    DROP CONSTRAINT "user_profiles_driver_age_check",
    ADD CONSTRAINT "user_profiles_driver_age_check"
        CHECK ("driver_age" IS NULL OR ("role" IN ('DRIVER', 'DISPATCHER') AND "driver_age" > 0)),
    ADD CONSTRAINT "user_profiles_company_name_check"
        CHECK ("company_name" IS NULL OR ("role" = 'COMPANY_OWNER' AND btrim("company_name") <> '' AND char_length("company_name") <= 200));
