import { isLocale } from "@freight/i18n";
import { notFound } from "next/navigation";
import { AuthForm } from "../../../components/auth/auth-form";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  return <AuthForm mode="forgot" locale={locale} invalid={Boolean(query.error)} />;
}
