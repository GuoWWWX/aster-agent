export const LIVE_PANEL_RESIZE_EVENT = "aster:live-panel-resize";

export type LivePanelResizeDetail = {
  id: string;
  phase: "start" | "move" | "end";
  size: number;
};

export function emitLivePanelResize(detail: LivePanelResizeDetail): void {
  window.dispatchEvent(new CustomEvent<LivePanelResizeDetail>(LIVE_PANEL_RESIZE_EVENT, {
    detail,
  }));
}
