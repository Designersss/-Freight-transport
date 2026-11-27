import { isLocale } from "@freight/i18n";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmailChangeConfirmation } from "../../../components/auth/email-change-confirmation";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <EmailChangeConfirmation locale={locale} />;
}
