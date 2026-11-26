import type { ComponentProps } from "react";
import { cn } from "../cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-xl border border-border bg-card p-5 text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}
