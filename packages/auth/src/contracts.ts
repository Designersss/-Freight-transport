import { z } from "zod";
import { isDeliverableEmail } from "./email.js";

const email = z
  .email()
  .transform((value) => value.toLowerCase())
  .refine(isDeliverableEmail);
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const locale = z.enum(["ru", "en"]).default("ru");

export const publicSession = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
  }),
  session: z.object({ expiresAt: z.string() }),
});

const publicRole = z.enum(["COMPANY_OWNER", "DISPATCHER", "DRIVER"]);
const profileName = z.string().trim().min(1).max(200);
export const birthDateInput = z.iso
  .date()
  .refine(
    (value) =>
      value >= "0001-01-01" && value <= new Date().toISOString().slice(0, 10),
  );

export const profileInput = z
  .strictObject({
    firstName: profileName,
    lastName: profileName,
    role: publicRole,
    birthDate: birthDateInput,
    companyName: profileName.optional(),
  })
  .refine(
    (value) =>
      value.role === "COMPANY_OWNER"
        ? value.companyName !== undefined
        : value.companyName === undefined,
    { path: ["companyName"] },
  );

export const profileSettingsInput = z.strictObject({
  firstName: profileName,
  lastName: profileName,
  birthDate: birthDateInput,
});

export const publicProfile = z.object({
  firstName: profileName,
  lastName: profileName,
  role: publicRole,
  birthDate: birthDateInput,
  companyName: profileName.nullable(),
});

export const usernameInput = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{2,31}$/)
  .transform((value) => value.toLowerCase())
  .refine((value) => !["admin", "support", "movaro"].includes(value));

const sessionId = z.string().min(1).max(128);

export const sessionAction = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("revoke"), id: sessionId }),
  z.strictObject({ action: z.literal("revokeOthers") }),
]);

export const publicActiveSessions = z.object({
  sessions: z.array(
    z.object({
      id: sessionId,
      current: z.boolean(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      userAgent: z.string().max(256).nullable(),
    }),
  ),
  hasMore: z.boolean(),
});

export const emailChangeInput = z.strictObject({
  newEmail: email,
  locale,
});

export const emailChangeTokenInput = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const publicTelegramSettings = z.object({
  linked: z.boolean(),
  canLink: z.boolean(),
  requiresFreshSession: z.boolean(),
});

export const usernameChangeInput = z.strictObject({ username: usernameInput });

export const publicUsernameSettings = z.object({
  username: usernameInput.nullable(),
  nextChangeAt: z.iso.datetime().nullable(),
});

export const usernameRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("check"), username: usernameInput }),
  z.strictObject({
    action: z.literal("suggest"),
    firstName: profileName,
    lastName: profileName,
  }),
]);

export const registrationInput = z.strictObject({
  profile: profileInput,
  username: usernameInput,
});

export const authBodies = {
  "/sign-up/email": z.strictObject({
    email,
    password,
    locale,
    registration: registrationInput,
  }),
  "/sign-in/email": z.strictObject({
    email,
    password,
  }),
  "/sign-out": z.strictObject({}),
  "/change-password": z.strictObject({
    currentPassword: password,
    newPassword: password,
  }),
  "/send-verification-email": z.strictObject({ email, locale }),
  "/request-password-reset": z.strictObject({ email, locale }),
  "/reset-password": z.strictObject({
    token: z.string().min(1).max(512),
    newPassword: password,
  }),
};
