import { isLocale } from "@freight/i18n";
import { notFound } from "next/navigation";
import { Account } from "../../../components/auth/account";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  return (
    <Account
      locale={locale}
      telegramLinkError={query.telegram === "link-error"}
      enterCabinet={query.onboarding === "1"}
    />
  );
}
