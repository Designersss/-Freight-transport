import { isLocale, messages } from "@freight/i18n";
import { Card, PageLayout } from "@freight/ui";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function Page({ params }: PageProps) {
  // No admin surface is exposed in production until real authorization (RD-04).
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <PageLayout title={messages[locale].admin.title}>
      <Card>
        <p className="movaro-description">
          {messages[locale].admin.description}
        </p>
      </Card>
    </PageLayout>
  );
}
