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
export const authBodies = {
  "/sign-up/email": z.strictObject({
    email,
    password,
    name: z.string().trim().min(1).max(200),
    locale,
  }),
  "/sign-in/email": z.strictObject({
    email,
    password,
  }),
  "/sign-out": z.strictObject({}),
  "/send-verification-email": z.strictObject({ email, locale }),
  "/request-password-reset": z.strictObject({ email, locale }),
  "/reset-password": z.strictObject({
    token: z.string().min(1).max(512),
    newPassword: password,
  }),
};

export const publicSession = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  session: z.object({ expiresAt: z.string() }),
});

const publicRole = z.enum(["COMPANY_OWNER", "DISPATCHER", "DRIVER"]);
const profileName = z.string().trim().min(1).max(200);
const driverAge = z.number().int().positive().max(2147483647);

export const profileInput = z
  .strictObject({
    firstName: profileName,
    lastName: profileName,
    role: publicRole,
    driverAge: driverAge.optional(),
    companyName: profileName.optional(),
  })
  .refine(
    (value) => value.role !== "COMPANY_OWNER" || value.driverAge === undefined,
  )
  .refine(
    (value) => value.role === "COMPANY_OWNER" || value.companyName === undefined,
  );

// Legacy profiles may lack a company name; new registration requires one.
export const registrationProfileInput = profileInput.refine(
  (value) => value.role !== "COMPANY_OWNER" || value.companyName !== undefined,
  { path: ["companyName"] },
);

export const publicProfile = z.object({
  firstName: profileName,
  lastName: profileName,
  role: publicRole,
  driverAge: driverAge.nullable(),
  companyName: profileName.nullable(),
});
