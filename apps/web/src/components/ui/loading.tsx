import type { ComponentProps, ReactElement } from "react";
import { cn } from "../../lib/cn.js";
import "./loading.css";

/** Compact loading indicator for buttons, toolbar actions and list rows. */
export function Spinner({ size = 15, className, style, ...props }: ComponentProps<"span"> & { size?: number }): ReactElement {
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
  return <span
    aria-hidden={labelled ? undefined : true}
    role={labelled ? "status" : undefined}
    {...props}
    className={cn("app-spinner inline-block shrink-0 rounded-full border-[1.5px] border-[var(--app-border)] border-t-current border-r-current align-middle", className)}
    style={{ width: size, height: size, ...style }}
  />;
}

/** Shared skeleton for an empty page or card while its content is loading. */
export function LoadingState({ label = "正在加载…", compact = false, className }: {
  label?: string;
  compact?: boolean;
  className?: string;
}): ReactElement {
  return <div role="status" className={cn("flex min-h-0 min-w-0 items-center justify-center text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]", compact ? "p-[5px]" : "p-3", className)}>
    <div className={cn("grid w-full min-w-0 max-w-[280px]", compact ? "gap-[5px]" : "gap-3")}>
      <span aria-hidden="true" className={cn("app-loading-bone block rounded-[var(--app-radius)]", compact ? "h-5" : "h-14")} />
      <span aria-hidden="true" className={cn("app-loading-bone block rounded-[var(--app-radius-small)]", compact ? "h-1.5" : "h-2")} />
      <span aria-hidden="true" className={cn("app-loading-bone block w-[62%] rounded-[var(--app-radius-small)]", compact ? "h-1.5" : "h-2")} />
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="app-loading-bone block size-3.5 shrink-0 rounded-[var(--app-radius-small)]" />
        <span className="min-w-0 break-words">{label}</span>
      </span>
    </div>
  </div>;
}
