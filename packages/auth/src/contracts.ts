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

export const publicRole = z.enum(["COMPANY_OWNER", "DISPATCHER", "DRIVER"]);
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

export const publicCabinet = z.object({ role: publicRole });

export const deactivateAccountInput = z.strictObject({
  confirm: z.literal(true),
});

export const adminLoginInput = z.strictObject({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const adminSession = z.object({
  name: z.string(),
  role: z.literal("PLATFORM_ADMIN"),
  expiresAt: z.string(),
});

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

export const emailChangeResponse = z.object({
  stage: z.enum(["old-sent", "new-sent", "completed"]),
});

export const telegramStartInput = z.strictObject({
  intent: z.enum(["login", "register", "link"]),
  locale: z.enum(["ru", "en"]),
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

export const registrationEmailStart = z.strictObject({ email, locale });
export const registrationEmailRead = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const registrationEmailComplete = registrationEmailRead.extend({
  password,
  registration: registrationInput,
});
export const registrationEmailAddress = z.object({ email });

export const authBodies = {
  "/sign-in/email": z.strictObject({
    email,
    password,
  }),
  "/sign-out": z.strictObject({}),
  "/change-password": z.strictObject({
    currentPassword: password,
    newPassword: password,
  }),
  "/request-password-reset": z.strictObject({ email, locale }),
  "/reset-password": z.strictObject({
    token: z.string().min(1).max(512),
    newPassword: password,
  }),
};

export const telegramDraftChannel = z.enum(["web", "bot"]);
const editInput = z.strictObject({
  action: z.literal("edit"),
  revision: z.number().int().min(0).max(2_147_483_646),
  firstName: profileSettingsInput.shape.firstName.optional(),
  lastName: profileSettingsInput.shape.lastName.optional(),
  role: publicRole.optional(),
  birthDate: birthDateInput.optional(),
  companyName: profileSettingsInput.shape.firstName.nullable().optional(),
  username: usernameInput.optional(),
});
export const telegramDraftMutationInput = z.discriminatedUnion("action", [
  editInput,
  z.strictObject({
    action: z.literal("switch"),
    revision: z.number().int().min(0).max(2_147_483_646),
    channel: telegramDraftChannel,
  }),
]);

const requestId = z.uuid();
const draftId = z.uuid();
const revision = z.number().int().min(0).max(2_147_483_646);
export const telegramBrowserCapability = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const telegramBrowserCommandInput = z.discriminatedUnion("action", [
  telegramStartInput.extend({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("status"), requestId }),
  z.strictObject({ action: z.literal("cancel"), requestId }),
  z.strictObject({
    action: z.literal("confirm"),
    requestId,
    proof: telegramBrowserCapability,
  }),
  z.strictObject({ action: z.literal("finish"), requestId }),
  z.strictObject({ action: z.literal("draft-find") }),
  z.strictObject({ action: z.literal("draft-state"), draftId }),
  z.strictObject({
    action: z.literal("draft-update"),
    draftId,
    mutation: telegramDraftMutationInput,
  }),
  z.strictObject({ action: z.literal("draft-suggest-username"), draftId }),
  z.strictObject({ action: z.literal("draft-complete"), draftId, revision }),
  z.strictObject({ action: z.literal("draft-cancel"), draftId, revision }),
  z.strictObject({ action: z.literal("draft-completion"), draftId }),
]);

export type TelegramBrowserCommand = z.infer<
  typeof telegramBrowserCommandInput
>;
