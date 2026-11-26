import { isLocale } from "@freight/i18n";
import { notFound } from "next/navigation";
import { Account } from "../../../components/auth/account";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <Account locale={locale} />;
}
