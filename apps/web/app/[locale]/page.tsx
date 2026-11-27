import { isLocale, messages } from "@freight/i18n";
import { Button, PageLayout } from "@freight/ui";
import { Link } from "@freight/ui/navigation";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <PageLayout title={messages[locale].web.title}>
      <p className="movaro-description">{messages[locale].web.description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/login" locale={locale}>
            {messages[locale].auth.login}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/signup" locale={locale}>
            {messages[locale].auth.signup}
          </Link>
        </Button>
      </div>
    </PageLayout>
  );
}
