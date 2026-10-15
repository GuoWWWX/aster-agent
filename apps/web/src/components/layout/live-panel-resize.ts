import type { PanelDrag } from "@agent/protocol";
export const LIVE_PANEL_RESIZE_EVENT = "aster:live-panel-resize";
export const NATIVE_PANEL_RESIZE_EVENT = "aster:native-panel-resize";
export type NativePanelResizeDetail = { id: string; phase: "move" | "end"; pointerX: number; size: number; collapsed: boolean };

export type LivePanelResizeDetail = {
  id: string;
  phase: "start" | "move" | "end";
  size: number;
  dragId?: string;
  drag?: PanelDrag;
  pointerX?: number;
  native?: boolean;
};

export function emitLivePanelResize(detail: LivePanelResizeDetail): void {
  window.dispatchEvent(new CustomEvent<LivePanelResizeDetail>(LIVE_PANEL_RESIZE_EVENT, {
    detail,
  }));
}
