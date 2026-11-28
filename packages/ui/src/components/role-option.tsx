"use client";

import {
  Building2,
  ChevronRight,
  Headset,
  Mail,
  Send,
  Truck,
} from "lucide-react";
import { Button } from "./button";

const icons = {
  COMPANY_OWNER: Building2,
  DISPATCHER: Headset,
  DRIVER: Truck,
  email: Mail,
  telegram: Send,
};

type ChoiceOptionProps = {
  choice: keyof typeof icons;
  title: string;
  description: string;
  disabled: boolean;
  onSelect: () => void;
};

export function ChoiceOption({
  choice,
  title,
  description,
  disabled,
  onSelect,
}: ChoiceOptionProps) {
  const Icon = icons[choice];
  return (
    <Button
      variant="outline"
      className="movaro-choice-option h-auto min-h-16 w-full justify-start gap-3 whitespace-normal p-3 text-left"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        className="movaro-choice-chevron text-muted-foreground"
        aria-hidden="true"
      />
    </Button>
  );
}

export function RoleOption({
  role,
  ...props
}: Omit<ChoiceOptionProps, "choice"> & {
  role: "COMPANY_OWNER" | "DISPATCHER" | "DRIVER";
}) {
  return <ChoiceOption choice={role} {...props} />;
}
