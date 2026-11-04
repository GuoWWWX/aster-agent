import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { NATIVE_TOOLTIP_POINTER } from "../../lib/native-overlay.js";
import type { NativeOverlayTooltipPointer } from "@agent/protocol";
import { useNativeOverlayContainer } from "./native-overlay-provider.js";

export function TooltipProvider({
  delayDuration = 0,
  skipDelayDuration = 0,
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

export const TooltipSideContext = createContext<ComponentProps<typeof TooltipPrimitive.Content>["side"]>("top");

type TooltipAnchorProps = {
  children: ReactElement;
  content: ReactNode;
  contentClassName?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: ComponentProps<typeof TooltipPrimitive.Content>["side"];
};

export function TooltipAnchor({
  children,
  content,
  contentClassName,
  disabled = false,
  open,
  onOpenChange,
  side,
}: TooltipAnchorProps): ReactElement {
  const defaultSide = useContext(TooltipSideContext);
  const container = useNativeOverlayContainer();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const dismissedByTrigger = useRef(false);
  const [visible, setVisible] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const isOpen = open ?? visible;
  const changeOpen = useCallback((value: boolean): void => {
    if (value && dismissedByTrigger.current) return;
    setVisible(value);
    if (!value) { setSelecting(false); pointerRef.current = null; }
    onOpenChange?.(value);
  }, [onOpenChange]);
  useEffect(() => {
    if (!isOpen) return;
    const documents = new Set([triggerRef.current?.ownerDocument, container?.ownerDocument, contentRef.current?.ownerDocument]);
    const close = (): void => changeOpen(false);
    const blur = (): void => {
      const popupDocument = contentRef.current?.ownerDocument;
      if (popupDocument !== triggerRef.current?.ownerDocument && popupDocument?.hasFocus()) return;
      close();
    };
    const move = (event: PointerEvent): void => {
      pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (!withinTooltip(triggerRef.current, contentRef.current, event)) close();
    };
    const nativeMove = (event: Event): void => {
      const { x, y } = (event as CustomEvent<NativeOverlayTooltipPointer>).detail;
      const point = { clientX: x, clientY: y };
      // A keyboard-opened hint stays until the pointer actually moves.
      if (pointerRef.current === null) { pointerRef.current = point; return; }
      pointerRef.current = point;
      if (!withinTooltip(triggerRef.current, contentRef.current, { ...point, target: null })) close();
    };
    window.addEventListener(NATIVE_TOOLTIP_POINTER, nativeMove);
    for (const doc of documents) {
      doc?.addEventListener("pointermove", move, true);
      doc?.defaultView?.addEventListener("blur", blur);
    }
    return () => {
      window.removeEventListener(NATIVE_TOOLTIP_POINTER, nativeMove);
      for (const doc of documents) {
        doc?.removeEventListener("pointermove", move, true);
        doc?.defaultView?.removeEventListener("blur", blur);
      }
    };
  }, [isOpen, changeOpen, container]);
  const dismissFromTrigger = (): void => {
    dismissedByTrigger.current = true;
    changeOpen(false);
  };
  const trigger = disabled ? <span className="inline-flex">{children}</span> : children;
  return (
    <TooltipPrimitive.Root disableHoverableContent open={isOpen} onOpenChange={changeOpen}>
      <TooltipPrimitive.Trigger ref={triggerRef} asChild onPointerDown={dismissFromTrigger} onClick={dismissFromTrigger} onKeyDown={(event) => {
        if (event.key === "Tab") dismissedByTrigger.current = false;
      }} onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        event.preventDefault();
        pointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        if (!isOpen) changeOpen(true);
      }} onBlur={(event) => {
        if (pointerRef.current !== null && pointerWithin(contentRef.current, { ...pointerRef.current, target: event.relatedTarget })) event.preventDefault();
        else changeOpen(false);
      }} onPointerLeave={(event) => {
        dismissedByTrigger.current = false;
        event.preventDefault();
        if (!withinTooltip(triggerRef.current, contentRef.current, { target: event.relatedTarget, clientX: event.clientX, clientY: event.clientY })) changeOpen(false);
      }}>{trigger}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={container}>
        <TooltipPrimitive.Content
          ref={contentRef}
          onPointerDown={() => setSelecting(true)}
          onPointerLeave={(event) => {
            if (!withinTooltip(triggerRef.current, contentRef.current, { target: event.relatedTarget, clientX: event.clientX, clientY: event.clientY })) changeOpen(false);
          }}
          data-native-view-overlay=""
          data-native-overlay-tooltip=""
          data-native-overlay-interactive={selecting ? "true" : "false"}
          className={cn(
            "z-[120] max-w-64 select-text rounded-[var(--app-radius)] border border-[var(--app-tooltip-background)] bg-[var(--app-tooltip-background)] px-2 py-1 text-[length:var(--app-font-size-caption)] font-medium leading-4 text-[var(--app-tooltip-foreground)] shadow-md",
            contentClassName,
          )}
          collisionPadding={5}
          side={side ?? defaultSide ?? "top"}
          sideOffset={5}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--app-tooltip-background)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// Keep the narrow space between the trigger and popup traversable without a hide delay.
function withinTooltip(trigger: HTMLElement | null, content: HTMLElement | null, event: Pick<PointerEvent, "target" | "clientX" | "clientY">): boolean {
  if (pointerWithin(trigger, event) || pointerWithin(content, event)) return true;
  if (trigger === null || content === null) return false;
  const a = trigger.getBoundingClientRect();
  const b = content.getBoundingClientRect();
  if (a.width <= 0 || b.width <= 0) return false;
  const { clientX: x, clientY: y } = event;
  if (b.bottom <= a.top || a.bottom <= b.top) {
    return y >= Math.min(a.bottom, b.bottom) && y <= Math.max(a.top, b.top)
      && x >= Math.min(a.left, b.left) && x <= Math.max(a.right, b.right);
  }
  if (b.right <= a.left || a.right <= b.left) {
    return x >= Math.min(a.right, b.right) && x <= Math.max(a.left, b.left)
      && y >= Math.min(a.top, b.top) && y <= Math.max(a.bottom, b.bottom);
  }
  return false;
}

// Native portals share window coordinates, but their DOM targets belong to another document.
function pointerWithin(element: HTMLElement | null, event: Pick<PointerEvent, "target" | "clientX" | "clientY">): boolean {
  if (element === null) return false;
  if (event.target !== null && "nodeType" in event.target && element.contains(event.target as Node)) return true;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
}
