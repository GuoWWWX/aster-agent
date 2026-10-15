import type { NativeOverlayRegionsInput, NativeOverlayResizePointer } from "@agent/protocol";

export const NATIVE_OVERLAY_READY = "aster:native-overlay-ready";

declare global {
  interface Window {
    nativeOverlay?: {
      update(input: NativeOverlayRegionsInput): void;
      onParentFocus(listener: () => void): () => void;
      onResizePointer(listener: (pointer: NativeOverlayResizePointer) => void): () => void;
    };
  }
}
