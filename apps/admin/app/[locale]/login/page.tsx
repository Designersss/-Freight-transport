import { adminPreviewAllowed } from "@freight/auth/proxy-ip";
import { isLocale, messages } from "@freight/i18n";
import { Header, parseTheme, themeCookie } from "@freight/ui";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminLogin } from "../../../components/admin-login";
import { readAdminSession } from "../../../lib/admin-session";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!adminPreviewAllowed(await headers(), process.env)) notFound();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await readAdminSession();
  if (session.kind === "authenticated") redirect(`/${locale}`);
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);
  return (
    <>
      <Header initialTheme={theme} locale={locale} />
      <AdminLogin
        locale={locale}
        initialFailure={
          session.kind === "unavailable"
            ? messages[locale].auth.unavailable
            : ""
        }
      />
    </>
  );
}
