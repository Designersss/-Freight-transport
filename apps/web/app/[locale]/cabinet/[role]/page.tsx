import { isLocale } from "@freight/i18n";
import { notFound, redirect } from "next/navigation";
import {
  CabinetFailure,
  CabinetView,
} from "../../../../components/cabinet/cabinet-view";
import { readCabinetAccess } from "../../../../lib/cabinet-access";
import { roleFromCabinet } from "../../../../lib/cabinet-paths";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; role: string }>;
}) {
  const { locale, role } = await params;
  if (!isLocale(locale)) notFound();
  const required = roleFromCabinet(role);
  if (!required) notFound();
  const access = await readCabinetAccess(required);
  if (access.kind === "anonymous") redirect(`/${locale}/login`);
  if (access.kind === "allowed")
    return <CabinetView locale={locale} profile={access.profile} />;
  return <CabinetFailure locale={locale} denied={access.kind === "denied"} />;
}
