import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "../../lib/cn.js";

export function TooltipProvider({
  delayDuration = 350,
  skipDelayDuration = 100,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>): ReactElement {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

type TooltipAnchorProps = {
  children: ReactElement;
  content: ReactNode;
  contentClassName?: string;
  disabled?: boolean;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
};

export function TooltipAnchor({
  children,
  content,
  contentClassName,
  disabled = false,
  side = "top",
}: TooltipAnchorProps): ReactElement {
  const trigger = disabled ? <span className="inline-flex">{children}</span> : children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={cn(
            "z-[120] max-w-64 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-2 py-1 text-[length:var(--app-font-size-caption)] font-medium leading-4 text-[var(--app-foreground)] shadow-md",
            contentClassName,
          )}
          collisionPadding={5}
          side={side}
          sideOffset={5}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--app-panel)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
