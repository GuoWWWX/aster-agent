import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/cn.js";

export function Select(
  props: ComponentProps<typeof SelectPrimitive.Root>,
): ReactElement {
  return <SelectPrimitive.Root {...props} />;
}

export function SelectTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>): ReactElement {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-2 text-[length:var(--app-font-size-control)] font-medium text-[var(--app-foreground)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-[border-color,box-shadow,background-color,color] hover:border-[#93c5fd] hover:bg-[#f8fbff] focus-visible:border-[#60a5fa] focus-visible:ring-2 focus-visible:ring-[#bfdbfe] data-[state=open]:border-[#60a5fa] data-[state=open]:bg-[#f8fbff] data-[state=open]:shadow-[0_0_0_2px_rgba(191,219,254,0.75)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_[data-slot=select-value]]:truncate",
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" className="shrink-0 text-[#64748b]" size={14} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectValue(
  props: ComponentProps<typeof SelectPrimitive.Value>,
): ReactElement {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectContent({
  children,
  className,
  collisionPadding = 8,
  position = "popper",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>): ReactElement {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-[100] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--app-radius)] border border-[#cbd5e1] bg-[var(--app-panel)] text-[var(--app-foreground)] shadow-[0_12px_28px_rgba(15,23,42,0.16)]",
          className,
        )}
        collisionPadding={collisionPadding}
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1.5">
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>): ReactElement {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex h-8 min-w-0 cursor-default select-none items-center rounded-[var(--app-radius)] py-1 pl-2.5 pr-8 text-[length:var(--app-font-size-control)] font-medium outline-none data-[state=checked]:bg-[#eff6ff] data-[state=checked]:text-[#1d4ed8] data-[disabled]:pointer-events-none data-[highlighted]:bg-[#f1f5f9] data-[highlighted]:text-[#1e3a5f] data-[disabled]:opacity-50",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 truncate">{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 grid size-4 place-items-center text-[#2563eb]">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" size={14} strokeWidth={2} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectScrollUpButton(
  props: ComponentProps<typeof SelectPrimitive.ScrollUpButton>,
): ReactElement {
  return (
    <SelectPrimitive.ScrollUpButton
      className="flex h-6 cursor-default items-center justify-center"
      {...props}
    >
      <ChevronUp aria-hidden="true" size={13} />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton(
  props: ComponentProps<typeof SelectPrimitive.ScrollDownButton>,
): ReactElement {
  return (
    <SelectPrimitive.ScrollDownButton
      className="flex h-6 cursor-default items-center justify-center"
      {...props}
    >
      <ChevronDown aria-hidden="true" size={13} />
    </SelectPrimitive.ScrollDownButton>
  );
}
