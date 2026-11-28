"use client";

import { type Locale, messages } from "@freight/i18n";
import { enUS, ru } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { TZDate } from "react-day-picker";
import { formatDateInput, parseDateInput } from "../lib/date-input";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "./popover";

type DatePickerProps = Omit<
  ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
};

function calendarDate(iso: string): Date {
  return new TZDate(new Date(`${iso}T00:00:00.000Z`), "UTC");
}

function DatePicker({
  locale,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  ...props
}: DatePickerProps) {
  const t = messages[locale].datePicker;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => calendarDate(max));
  const iso = parseDateInput(value, locale);
  const selected =
    iso && iso >= min && iso <= max ? calendarDate(iso) : undefined;
  const dateLabel = new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : "en-US",
    { dateStyle: "full", timeZone: "UTC" },
  );

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setMonth(selected ?? calendarDate(max));
    setOpen(nextOpen);
  }

  return (
    <Popover open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverAnchor asChild>
        <div className="relative min-w-0">
          <Input
            {...props}
            type="text"
            value={value}
            disabled={disabled}
            placeholder={t.placeholder}
            maxLength={10}
            className={cn("pr-10", className)}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              const parsed = parseDateInput(next, locale);
              if (parsed && parsed >= min && parsed <= max) {
                setMonth(calendarDate(parsed));
              }
            }}
          />
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-0.5 right-0.5 text-muted-foreground"
              aria-label={t.open}
              disabled={disabled}
            >
              <CalendarDays aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent aria-label={t.open} className="w-72">
        <Calendar
          mode="single"
          required
          timeZone="UTC"
          locale={locale === "ru" ? ru : enUS}
          captionLayout="dropdown"
          reverseYears
          month={month}
          onMonthChange={setMonth}
          startMonth={calendarDate(min)}
          endMonth={calendarDate(max)}
          disabled={[
            { before: calendarDate(min) },
            { after: calendarDate(max) },
          ]}
          selected={selected}
          labels={{
            labelNav: () => t.navigation,
            labelMonthDropdown: () => t.month,
            labelYearDropdown: () => t.year,
            labelPrevious: () => t.previous,
            labelNext: () => t.next,
            labelDayButton: (date, modifiers) =>
              [
                modifiers.today ? t.today : "",
                dateLabel.format(date),
                modifiers.selected ? t.selected : "",
              ]
                .filter(Boolean)
                .join(", "),
          }}
          onSelect={(date) => {
            const next = date.toISOString().slice(0, 10);
            if (next < min || next > max) return;
            onChange(formatDateInput(next, locale));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
