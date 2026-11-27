import type { Locale } from "@freight/i18n";

export function parseDateInput(value: string, locale: Locale): string | null {
  const text = value.trim();
  let iso = text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts =
      locale === "ru"
        ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text)
        : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!parts) return null;
    const [, first, second, year] = parts;
    iso =
      locale === "ru"
        ? `${year}-${second}-${first}`
        : `${year}-${first}-${second}`;
  }
  if (iso < "0001-01-01") return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function formatDateInput(iso: string, locale: Locale): string {
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  return locale === "ru"
    ? `${day}.${month}.${year}`
    : `${month}/${day}/${year}`;
}
