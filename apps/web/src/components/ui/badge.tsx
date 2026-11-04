import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactElement } from "react";

import { cn } from "../../lib/cn.js";

const badgeVariants = cva(
  "inline-flex min-h-[20px] shrink-0 items-center rounded-[var(--app-radius-pill)] px-[7px] py-[2px] text-[length:var(--app-font-size-caption)] font-semibold",
  {
    variants: {
      tone: {
        danger: "bg-[var(--app-status-danger-bg)] text-[var(--app-status-danger-fg)]",
        info: "bg-[var(--app-status-info-bg)] text-[var(--app-status-info-fg)]",
        neutral: "bg-[var(--app-status-neutral-bg)] text-[var(--app-status-neutral-fg)]",
        success: "bg-[var(--app-status-success-bg)] text-[var(--app-status-success-fg)]",
        warning: "bg-[var(--app-status-warning-bg)] text-[var(--app-status-warning-fg)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

type BadgeProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps): ReactElement {
  return (
    <span
      {...props}
      className={cn(badgeVariants({ tone }), className)}
      data-slot="badge"
      data-tone={tone ?? "neutral"}
    />
  );
}
