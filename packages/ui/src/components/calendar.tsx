"use client";

// Adapted from the shadcn new-york-v4 calendar registry (MIT).
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { type ComponentProps, useEffect, useRef } from "react";
import {
  type DayButton,
  DayPicker,
  type DayPickerProps,
} from "react-day-picker";
import { cn } from "../lib/utils";
import { Button, buttonVariants } from "./button";

function CalendarChevron({
  orientation,
  className,
}: ComponentProps<typeof import("react-day-picker").Chevron>) {
  const Icon =
    orientation === "left"
      ? ChevronLeftIcon
      : orientation === "right"
        ? ChevronRightIcon
        : ChevronDownIcon;

  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant={modifiers.selected ? "default" : "ghost"}
      size="icon-sm"
      data-date={day.date.toISOString().slice(0, 10)}
      className={cn("w-full font-normal", className)}
      {...props}
    />
  );
}

function Calendar({
  className,
  classNames,
  components,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      className={cn("w-full min-w-0 text-[13px]", className)}
      navLayout="around"
      classNames={{
        root: "w-full",
        months: "w-full",
        month: "relative flex w-full flex-col gap-2",
        month_caption: "flex h-8 items-center justify-center px-8",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "absolute top-0 left-0 aria-disabled:opacity-40",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "absolute top-0 right-0 aria-disabled:opacity-40",
        ),
        dropdowns: "flex items-center justify-center gap-1",
        dropdown_root:
          "relative rounded-md border border-border has-focus:outline has-focus:outline-ring",
        dropdown: "absolute inset-0 w-full cursor-pointer opacity-0",
        caption_label:
          "flex h-8 items-center gap-1 px-2 font-medium whitespace-nowrap",
        month_grid: "w-full table-fixed border-collapse",
        weekday: "h-7 text-center text-xs font-normal text-muted-foreground",
        day: "p-0 text-center",
        today: "[&>button]:border [&>button]:border-primary",
        outside: "text-muted-foreground opacity-60",
        disabled: "opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
