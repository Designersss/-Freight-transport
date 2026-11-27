import { isLocale } from "@freight/i18n";
import { notFound, redirect } from "next/navigation";
import { CabinetFailure } from "../../../components/cabinet/cabinet-view";
import { readCabinetAccess } from "../../../lib/cabinet-access";
import { cabinetPaths } from "../../../lib/cabinet-paths";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const access = await readCabinetAccess();
  if (access.kind === "anonymous") redirect(`/${locale}/login`);
  if (access.kind === "onboarding")
    redirect(`/${locale}/account?onboarding=1`);
  if (access.kind === "allowed")
    redirect(`/${locale}${cabinetPaths[access.profile.role]}`);
  return <CabinetFailure locale={locale} denied={access.kind === "denied"} />;
}
