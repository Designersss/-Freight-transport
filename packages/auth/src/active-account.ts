export const eligibleAccount = `FROM "user" u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN "session" s ON s."userId" = u.id
  WHERE u.id = $1 AND s.id = $2 AND s."expiresAt" > clock_timestamp()
    AND u."emailVerified" = true AND u."registrationDraft" IS NULL
    AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'`;
