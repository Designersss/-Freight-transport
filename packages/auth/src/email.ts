import { z } from "zod";

const emailSchema = z.email();

// Internal OAuth identity addresses are not real delivery destinations.
export function isDeliverableEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    emailSchema.safeParse(normalized).success &&
    !normalized.endsWith(".invalid")
  );
}

export type AuthMailKind =
  | "registration-email"
  | "reset-password"
  | "email-change-old"
  | "email-change-new";

export interface AuthMailer {
  send(kind: AuthMailKind, email: string, url: string): Promise<void>;
}
