import { z } from "zod";

export type Locale = "ru" | "en";
export const role = z.enum(["COMPANY_OWNER", "DISPATCHER", "DRIVER"]);
export type Role = z.infer<typeof role>;
export const claimResult = z
  .object({
    id: z.uuid(),
    intent: z.enum(["login", "register", "link"]),
    locale: z.enum(["ru", "en"]),
    displayCode: z.string().regex(/^[0-9]{6}$/),
    expiresAt: z.iso.datetime(),
    needsContact: z.boolean(),
  })
  .strict()
  .nullable();
export type Claim = NonNullable<z.infer<typeof claimResult>>;
export const draftResult = z
  .object({
    id: z.uuid(),
    channel: z.enum(["web", "bot"]),
    locale: z.enum(["ru", "en"]),
    revision: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    role: role.nullable(),
    birthDate: z.string().nullable(),
    companyName: z.string().nullable(),
    username: z.string().nullable(),
  })
  .strict()
  .nullable();
export type Draft = NonNullable<z.infer<typeof draftResult>>;
export const draftIdResult = z.uuid().nullable();
export const proofResult = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .nullable();
export const usernameResult = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,31}$/)
  .nullable();
export const completionResult = z.enum([
  "created",
  "invalid",
  "denied",
  "username-taken",
  "identity-taken",
]);
