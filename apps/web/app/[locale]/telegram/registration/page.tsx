import { isLocale } from "@freight/i18n";
import { notFound } from "next/navigation";
import { TelegramRegistration } from "../../../../components/auth/telegram-registration";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <TelegramRegistration locale={locale} />;
}
