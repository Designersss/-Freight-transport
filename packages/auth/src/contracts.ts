import { z } from "zod";
import { isDeliverableEmail } from "./email.js";

const email = z
  .email()
  .transform((value) => value.toLowerCase())
  .refine(isDeliverableEmail);
const password = z.string().min(12).max(128);
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
    password: z.string().min(1).max(128),
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

