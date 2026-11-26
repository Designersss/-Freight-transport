import { isLocale, messages } from "@freight/i18n";
import { PageLayout } from "@freight/ui";
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
    </PageLayout>
  );
}
