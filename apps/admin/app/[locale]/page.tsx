import { adminPreviewAllowed } from "@freight/auth/proxy-ip";
import { isLocale, messages } from "@freight/i18n";
import {
  AppShell,
  Card,
  CardContent,
  Header,
  PageLayout,
  parseTheme,
  Sidebar,
  themeCookie,
} from "@freight/ui";
import { LayoutDashboard } from "lucide-react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminLogout } from "../../components/admin-logout";
import { readAdminSession } from "../../lib/admin-session";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function Page({ params }: PageProps) {
  if (!adminPreviewAllowed(await headers(), process.env)) notFound();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await readAdminSession();
  if (session.kind !== "authenticated") redirect(`/${locale}/login`);
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);
  const t = messages[locale].admin;

  return (
    <AppShell
      header={<Header initialTheme={theme} locale={locale} showBrand={false} />}
      sidebar={
        <Sidebar
          brandHref="/"
          navigationLabel={messages[locale].common.navigation}
          items={[
            {
              href: "/",
              label: t.title,
              icon: <LayoutDashboard aria-hidden="true" size={16} />,
            },
          ]}
        />
      }
    >
      <PageLayout title={t.title}>
        <Card className="max-w-xl">
          <CardContent className="flex flex-col gap-4">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">
                {session.data.name}
              </h2>
              <p className="text-muted-foreground">{t.role}</p>
            </div>
            <AdminLogout locale={locale} />
          </CardContent>
        </Card>
      </PageLayout>
    </AppShell>
  );
}
