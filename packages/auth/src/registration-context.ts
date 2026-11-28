import { AsyncLocalStorage } from "node:async_hooks";
import type { z } from "zod";
import type { registrationInput } from "./contracts.js";

interface RegistrationContext {
  email: string;
  proofHash: string;
  registration: z.infer<typeof registrationInput>;
}

export const registrationContext = new AsyncLocalStorage<RegistrationContext>();
