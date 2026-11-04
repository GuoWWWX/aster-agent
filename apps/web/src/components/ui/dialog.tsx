import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { useNativeOverlayContainer } from "./native-overlay-provider.js";
import { useWorkbenchModalBackdrop, WORKBENCH_MODAL_BACKDROP_CLASS } from "./use-workbench-modal-backdrop.js";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>): ReactElement {
  const container = useNativeOverlayContainer();
  return <DialogPrimitive.Portal container={container} {...props} />;
}

export function DialogOverlay({
  className,
  style,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>): ReactElement {
  const bounds = useWorkbenchModalBackdrop();
  return (
    <DialogPrimitive.Overlay
      className={cn("fixed inset-0 z-[100]", WORKBENCH_MODAL_BACKDROP_CLASS, className)}
      style={{ ...bounds, ...style }}
      data-slot="dialog-overlay"
      data-native-view-overlay=""
      {...props}
    />
  );
}

export function DialogContent({
  children,
  className,
  overlayClassName,
  overlayStyle,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  showCloseButton?: boolean;
}): ReactElement {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} style={overlayStyle} />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[101] grid w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[var(--app-radius)] bg-[var(--app-panel)] text-[var(--app-foreground)] shadow-2xl outline-none",
          className,
        )}
        data-slot="dialog-content"
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <button
              aria-label="关闭"
              className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[var(--app-radius)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
              data-slot="dialog-close"
              title="关闭"
              type="button"
            >
              <X className="size-4" />
            </button>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentProps<"div">): ReactElement {
  return <div className={cn("flex flex-col gap-1", className)} data-slot="dialog-header" {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn("text-sm font-semibold", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs text-[var(--app-muted-foreground)]", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export function DialogFooter({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { children?: ReactNode }): ReactElement {
  return <div className={cn("flex justify-end gap-2", className)} data-slot="dialog-footer" {...props}>{children}</div>;
}
