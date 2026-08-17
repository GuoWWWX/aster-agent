import { cva, type VariantProps } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ReactElement,
  ReactNode,
} from "react";

import { cn } from "../../lib/cn.js";

const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-[var(--app-radius)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      size: {
        activity: "size-10",
        compact: "size-8",
        titlebar: "h-9 w-8",
      },
      variant: {
        active:
          "bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:bg-[#1d4ed8]",
        destructive:
          "text-[var(--app-muted-foreground)] hover:bg-[var(--app-destructive)] hover:text-[var(--app-destructive-foreground)]",
        quiet:
          "text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)]",
        titlebar:
          "rounded-none text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)]",
      },
    },
    defaultVariants: {
      size: "compact",
      variant: "quiet",
    },
  },
);

type IconButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "children" | "title"
> &
  VariantProps<typeof iconButtonVariants> & {
    children: ReactNode;
    label: string;
  };

export function IconButton({
  children,
  className,
  label,
  size,
  type = "button",
  variant,
  ...buttonProps
}: IconButtonProps): ReactElement {
  return (
    <button
      {...buttonProps}
      aria-label={label}
      className={cn(iconButtonVariants({ size, variant }), className)}
      data-slot="icon-button"
      title={label}
      type={type}
    >
      {children}
    </button>
  );
}
