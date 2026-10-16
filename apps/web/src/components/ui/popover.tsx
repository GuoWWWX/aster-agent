import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/cn.js";
import { useNativeOverlayContainer } from "./native-overlay-provider.js";

export const Popover = PopoverPrimitive.Root;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  children,
  className,
  collisionPadding = 10,
  side = "top",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>): ReactElement {
  const container = useNativeOverlayContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-native-view-overlay=""
        className={cn(
          "z-[100] max-h-[var(--radix-popover-content-available-height)] overflow-auto outline-none",
          className,
        )}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
