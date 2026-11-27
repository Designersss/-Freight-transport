-- A user may have at most one Telegram identity. The existing provider/account
-- unique index separately prevents two users owning the same Telegram subject.
CREATE UNIQUE INDEX "account_telegram_user_uidx" ON "account"("userId")
    WHERE "providerId" = 'telegram';
