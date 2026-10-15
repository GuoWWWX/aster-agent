import { app, ipcMain, screen, type BrowserWindow, type IpcMainEvent, type Rectangle, type WebContents, type WindowOpenHandlerResponse } from "electron";
import path from "node:path";
import {
  NATIVE_OVERLAY_CHANNEL,
  NATIVE_OVERLAY_BLUR_CHANNEL,
  NATIVE_OVERLAY_FRAME_NAME,
  NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL,
  nativeOverlayRegionsInputSchema,
  type NativeOverlayRegionsInput,
  type NativeOverlayResizePointer,
} from "@agent/protocol";

/** Owns the one sandboxed React overlay host above the parent's native browser views. */
export class NativeOverlayController {
  private overlayWindow: BrowserWindow | undefined;
  private allowedUrl: string | undefined;
  private detachOverlay: (() => void) | undefined;
  private input: NativeOverlayRegionsInput = { regions: [], interactive: false };
  private visible = false;
  private interactive = false;
  private disposed = false;
  private readonly resizeContents = new Set<WebContents>();
  private lastBounds: Rectangle | undefined;
  private readonly parentContents: WebContents;

  public constructor(private readonly parentWindow: BrowserWindow,
    private readonly resizeDirectly?: (pointer: NativeOverlayResizePointer) => boolean,
    private readonly cancelDirectResize?: () => void) {
    this.parentContents = parentWindow.webContents;
    this.parentContents.on("did-create-window", this.attachOverlay);
    this.parentContents.on("did-start-navigation", this.releaseDocumentOverlay);
    this.parentContents.on("zoom-changed", this.synchronize);
    parentWindow.on("move", this.synchronize);
    parentWindow.on("resize", this.synchronize);
    parentWindow.on("show", this.synchronize);
    parentWindow.on("hide", this.synchronize);
    parentWindow.on("minimize", this.synchronize);
    parentWindow.on("restore", this.synchronize);
    parentWindow.on("closed", this.dispose);
    app.on("before-quit", this.dispose);
    ipcMain.on(NATIVE_OVERLAY_CHANNEL, this.receiveRegions);
  }

  /** Called only after the renderer policy matches the exact internal host URL and frame name. */
  public allowWindow(url: string): WindowOpenHandlerResponse {
    if ((process.platform !== "win32" && process.platform !== "linux")
      || this.disposed || this.overlayWindow !== undefined) return { action: "deny" };
    this.allowedUrl = url;
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        ...this.parentWindow.getContentBounds(),
        parent: this.parentWindow,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        show: false,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        thickFrame: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          backgroundThrottling: false,
          preload: path.resolve(__dirname, "../preload/native-overlay.cjs"),
        },
      },
    };
  }

  public readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    ipcMain.removeListener(NATIVE_OVERLAY_CHANNEL, this.receiveRegions);
    app.removeListener("before-quit", this.dispose);
    this.parentWindow.removeListener("closed", this.dispose);
    this.parentWindow.removeListener("move", this.synchronize);
    this.parentWindow.removeListener("resize", this.synchronize);
    this.parentWindow.removeListener("show", this.synchronize);
    this.parentWindow.removeListener("hide", this.synchronize);
    this.parentWindow.removeListener("minimize", this.synchronize);
    this.parentWindow.removeListener("restore", this.synchronize);
    this.parentContents.removeListener("did-create-window", this.attachOverlay);
    this.parentContents.removeListener("did-start-navigation", this.releaseDocumentOverlay);
    this.parentContents.removeListener("zoom-changed", this.synchronize);
    this.releaseOverlay(true);
  };

  private readonly releaseDocumentOverlay = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    if (event.isMainFrame && !event.isSameDocument) this.releaseOverlay(true);
  };

  private readonly attachOverlay = (window: BrowserWindow, details: Electron.DidCreateWindowDetails): void => {
    if (details.frameName !== NATIVE_OVERLAY_FRAME_NAME || details.url !== this.allowedUrl) return;
    if (this.disposed || this.overlayWindow !== undefined) {
      window.destroy();
      return;
    }
    this.overlayWindow = window;
    const contents = window.webContents;
    const denyNavigation = (event: Electron.Event, url: string): void => {
      if (url !== this.allowedUrl) event.preventDefault();
    };
    const denyFrameNavigation = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
      if (!event.isMainFrame || event.url !== this.allowedUrl) event.preventDefault();
    };
    const close = (): void => this.releaseOverlay(false);
    const crashed = (): void => this.releaseOverlay(true);
    let pendingParentFocus = false;
    let blurTimer: ReturnType<typeof setImmediate> | undefined;
    const notifyParentFocus = (): void => {
      if (pendingParentFocus && this.visible && this.interactive && this.parentWindow.isFocused()) {
        pendingParentFocus = false;
        contents.send(NATIVE_OVERLAY_BLUR_CHANNEL);
      }
    };
    const blurred = (): void => {
      pendingParentFocus = true;
      if (blurTimer !== undefined) clearImmediate(blurTimer);
      blurTimer = setImmediate(() => { blurTimer = undefined; notifyParentFocus(); });
    };
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", denyNavigation);
    contents.on("will-redirect", denyNavigation);
    contents.on("will-frame-navigate", denyFrameNavigation);
    contents.on("render-process-gone", crashed);
    window.on("blur", blurred);
    window.on("closed", close);
    this.parentWindow.on("focus", notifyParentFocus);
    this.detachOverlay = () => {
      if (blurTimer !== undefined) clearImmediate(blurTimer);
      this.parentWindow.removeListener("focus", notifyParentFocus);
      contents.removeListener("will-navigate", denyNavigation);
      contents.removeListener("will-redirect", denyNavigation);
      contents.removeListener("will-frame-navigate", denyFrameNavigation);
      contents.removeListener("render-process-gone", crashed);
      window.removeListener("blur", blurred);
      window.removeListener("closed", close);
    };
    this.synchronize();
  };

  private readonly receiveRegions = (event: IpcMainEvent, ...args: unknown[]): void => {
    const window = this.overlayWindow;
    if (window === undefined || window.isDestroyed() || args.length !== 1
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    const parsed = nativeOverlayRegionsInputSchema.safeParse(args[0]);
    if (!parsed.success) return;
    this.input = parsed.data;
    if (this.input.resizing === true) this.startResize();
    else this.stopResize();
    this.synchronize();
  };

  private startResize(): void {
    if (this.resizeContents.size > 0 || this.overlayWindow === undefined) return;
    const views = this.parentWindow.contentView.children
      .filter((view): view is Electron.WebContentsView => "webContents" in view);
    for (const contents of [this.parentContents, this.overlayWindow.webContents, ...views.map((view) => view.webContents)]) {
      if (this.resizeContents.has(contents)) continue;
      this.resizeContents.add(contents);
      contents.on("before-mouse-event", this.relayResize);
    }
  }

  private readonly relayResize = (event: Electron.Event, mouse: Electron.MouseInputEvent): void => {
    const window = this.overlayWindow;
    if (window === undefined || (mouse.type !== "mouseMove" && mouse.type !== "mouseUp")
      || (mouse.type === "mouseUp" && mouse.button !== "left")) return;
    const cursor = mouse.globalX === undefined || mouse.globalY === undefined
      ? screen.getCursorScreenPoint() : { x: mouse.globalX, y: mouse.globalY };
    const bounds = this.parentWindow.getContentBounds();
    const zoom = this.parentContents.getZoomFactor();
    event.preventDefault();
    const pointer: NativeOverlayResizePointer = {
      phase: mouse.type === "mouseUp" ? "end" : "move",
      x: (cursor.x - bounds.x) / zoom,
      y: (cursor.y - bounds.y) / zoom,
    };
    if (!this.resizeDirectly?.(pointer)) window.webContents.send(NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL, pointer);
    if (mouse.type === "mouseUp") this.stopResize();
  };

  private stopResize(): void {
    if (this.resizeContents.size > 0) this.cancelDirectResize?.();
    for (const contents of this.resizeContents) contents.removeListener("before-mouse-event", this.relayResize);
    this.resizeContents.clear();
  }

  private readonly synchronize = (): void => {
    const window = this.overlayWindow;
    if (window === undefined || window.isDestroyed() || this.parentWindow.isDestroyed()) return;
    const bounds = this.parentWindow.getContentBounds();
    const zoom = this.parentContents.getZoomFactor();
    if (this.lastBounds === undefined || bounds.x !== this.lastBounds.x || bounds.y !== this.lastBounds.y
      || bounds.width !== this.lastBounds.width || bounds.height !== this.lastBounds.height) {
      window.setBounds(bounds);
      this.lastBounds = { ...bounds };
    }
    if (window.webContents.getZoomFactor() !== zoom) window.webContents.setZoomFactor(zoom);
    const regions: Rectangle[] = this.input.regions.flatMap((region) => {
      if (region.width === 0 || region.height === 0) return [];
      const x = Math.min(bounds.width, Math.floor(region.x * zoom));
      const y = Math.min(bounds.height, Math.floor(region.y * zoom));
      const width = Math.min(bounds.width, Math.ceil((region.x + region.width) * zoom)) - x;
      const height = Math.min(bounds.height, Math.ceil((region.y + region.height) * zoom)) - y;
      return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
    });
    if (regions.length === 0 || !this.parentWindow.isVisible() || this.parentWindow.isMinimized()) {
      const restoreFocus = window.isFocused() && this.parentWindow.isVisible() && !this.parentWindow.isMinimized();
      this.visible = false;
      this.interactive = false;
      window.hide();
      if (restoreFocus) this.parentWindow.focus();
      return;
    }
    window.setShape(regions);
    window.setIgnoreMouseEvents(false);
    window.setFocusable(this.input.interactive);
    if (!this.visible) window.showInactive();
    if (this.input.interactive && !this.interactive) window.focus();
    this.visible = true;
    this.interactive = this.input.interactive;
  };

  private releaseOverlay(destroy: boolean): void {
    this.stopResize();
    this.cancelDirectResize?.();
    const window = this.overlayWindow;
    this.detachOverlay?.();
    this.detachOverlay = undefined;
    this.overlayWindow = undefined;
    this.input = { regions: [], interactive: false };
    this.visible = false;
    this.interactive = false;
    this.lastBounds = undefined;
    if (destroy && window !== undefined && !window.isDestroyed()) window.destroy();
  }
}
