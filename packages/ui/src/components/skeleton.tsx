// Adapted from the official shadcn new-york-v4 registry (MIT); see docs/licenses/shadcn.txt.
import type * as React from "react"
import { cn } from "../lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("motion-safe:animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  )
}

export { Skeleton }
