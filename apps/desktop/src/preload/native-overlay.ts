import { contextBridge, ipcRenderer } from "electron";
// The protocol barrel pulls Node-only YAML code into this sandboxed preload.
import {
  NATIVE_OVERLAY_CHANNEL,
  NATIVE_OVERLAY_BLUR_CHANNEL,
  NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL,
  nativeOverlayResizePointerSchema,
  nativeOverlayRegionsInputSchema,
  type NativeOverlayRegionsInput,
  type NativeOverlayResizePointer,
} from "../../../../packages/protocol/src/native-overlay.js";

// The overlay host receives no application or raw IPC bridge.
contextBridge.exposeInMainWorld("nativeOverlay", {
  update(input: NativeOverlayRegionsInput): void {
    ipcRenderer.send(NATIVE_OVERLAY_CHANNEL, nativeOverlayRegionsInputSchema.parse(input));
  },
  onParentFocus(listener: () => void): () => void {
    const notify = (): void => listener();
    ipcRenderer.on(NATIVE_OVERLAY_BLUR_CHANNEL, notify);
    return () => { ipcRenderer.removeListener(NATIVE_OVERLAY_BLUR_CHANNEL, notify); };
  },
  onResizePointer(listener: (pointer: NativeOverlayResizePointer) => void): () => void {
    const notify = (_event: Electron.IpcRendererEvent, input: unknown): void => {
      const parsed = nativeOverlayResizePointerSchema.safeParse(input);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL, notify);
    return () => { ipcRenderer.removeListener(NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL, notify); };
  },
});
