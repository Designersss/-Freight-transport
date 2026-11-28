import { isLocale } from "@freight/i18n";
import { notFound } from "next/navigation";
import { TelegramWaitScreen } from "../../../../components/auth/telegram-browser-flow";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <TelegramWaitScreen locale={locale} />;
}
