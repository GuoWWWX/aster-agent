import type { ComponentProps, ReactElement } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "../../lib/cn.js";

export function SettingsCategoryHeading({
  icon: Icon,
  className,
  children,
  ...props
}: ComponentProps<"h3"> & { icon: LucideIcon }): ReactElement {
  return (
    <h3 {...props} className={cn("mb-3 flex min-w-0 items-center gap-2 text-[length:var(--app-font-size-body)] font-semibold", className)}>
      <Icon aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
      {children}
    </h3>
  );
}

export function SettingsConfigurationCard({
  className,
  ...props
}: ComponentProps<"section">): ReactElement {
  return (
    <section
      {...props}
      className={cn(
        "settings-configuration-card min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-4 [--settings-control-background:var(--app-panel-subtle)]",
        className,
      )}
    />
  );
}
