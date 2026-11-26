import { routing } from "@freight/i18n/routing";
import { createNavigation } from "next-intl/navigation";

export const { Link, usePathname } = createNavigation(routing);
