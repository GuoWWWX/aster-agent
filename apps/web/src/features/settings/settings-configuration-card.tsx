import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/cn.js";

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
