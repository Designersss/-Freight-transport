"use client";

import { Building2, ChevronRight, Headset, Truck } from "lucide-react";
import { useId } from "react";
import { Button } from "./button";

const icons = {
  COMPANY_OWNER: Building2,
  DISPATCHER: Headset,
  DRIVER: Truck,
};

export function RoleOption({
  role,
  title,
  description,
  disabled,
  onSelect,
}: {
  role: keyof typeof icons;
  title: string;
  description: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const descriptionId = useId();
  const Icon = icons[role];
  return (
    <Button
      variant="outline"
      className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal p-3 text-left"
      aria-label={title}
      aria-describedby={descriptionId}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span
          id={descriptionId}
          className="block text-xs font-normal text-muted-foreground"
        >
          {description}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}
