import type { NativeOverlayRegionsInput, NativeOverlayResizePointer, NativeOverlayTooltipPointer } from "@agent/protocol";

export const NATIVE_OVERLAY_READY = "aster:native-overlay-ready";
export const NATIVE_TOOLTIP_POINTER = "aster:native-tooltip-pointer";

declare global {
  interface Window {
    nativeOverlay?: {
      update(input: NativeOverlayRegionsInput): void;
      onParentFocus(listener: () => void): () => void;
      onResizePointer(listener: (pointer: NativeOverlayResizePointer) => void): () => void;
      onTooltipPointer(listener: (pointer: NativeOverlayTooltipPointer) => void): () => void;
    };
  }
}
