import { isLocale } from "@freight/i18n";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignupWizard } from "../../../components/auth/signup-wizard";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <SignupWizard locale={locale} />;
}
