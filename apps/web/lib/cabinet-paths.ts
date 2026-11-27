import type { publicRole } from "@freight/auth/contracts";
import type { z } from "zod";

type Role = z.infer<typeof publicRole>;

export const cabinetPaths = {
  COMPANY_OWNER: "/cabinet/company-owner",
  DISPATCHER: "/cabinet/dispatcher",
  DRIVER: "/cabinet/driver",
} as const satisfies Record<Role, string>;

export function roleFromCabinet(segment: string): Role | undefined {
  switch (segment) {
    case "company-owner":
      return "COMPANY_OWNER";
    case "dispatcher":
      return "DISPATCHER";
    case "driver":
      return "DRIVER";
    default:
      return undefined;
  }
}
