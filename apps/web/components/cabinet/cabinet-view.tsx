import type { publicProfile } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  PageLayout,
} from "@freight/ui";
import { Link } from "@freight/ui/navigation";
import type { z } from "zod";

export function CabinetView({
  locale,
  profile,
}: {
  locale: Locale;
  profile: z.infer<typeof publicProfile>;
}) {
  const t = messages[locale].auth;
  return (
    <PageLayout title={t.cabinetTitles[profile.role]}>
      <Card className="max-w-xl">
        <CardContent className="flex flex-col gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="text-muted-foreground">
              {t.cabinetRole}: {t.roles[profile.role]}
            </p>
          </div>
          <div>
            <Button asChild variant="outline">
              <Link href="/account" prefetch={false}>
                {t.cabinetSettings}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageLayout>
  );
}

export function CabinetFailure({
  locale,
  denied,
}: {
  locale: Locale;
  denied: boolean;
}) {
  const t = messages[locale].auth;
  return (
    <PageLayout title={t.cabinetTitle}>
      <div className="flex max-w-xl flex-col gap-4">
        <Alert variant="destructive">
          <AlertDescription>
            {denied ? t.cabinetDenied : t.cabinetUnavailable}
          </AlertDescription>
        </Alert>
        <div>
          <Button asChild variant="outline">
            <Link href="/account" prefetch={false}>
              {t.cabinetSettings}
            </Link>
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
