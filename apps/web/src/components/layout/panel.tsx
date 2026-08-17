import type { ComponentPropsWithoutRef, ReactElement } from "react";

import { cn } from "../../lib/cn.js";

type WorkbenchPanelProps = ComponentPropsWithoutRef<"section">;

export function WorkbenchPanel({
  children,
  className,
  ...sectionProps
}: WorkbenchPanelProps): ReactElement {
  return (
    <section
      {...sectionProps}
      className={cn("workbench-panel", className)}
      data-slot="workbench-panel"
    >
      {children}
    </section>
  );
}
