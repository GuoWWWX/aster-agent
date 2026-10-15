import { app, shell, type BrowserWindow, type WebContents, type WindowOpenHandlerResponse } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NATIVE_OVERLAY_FRAME_NAME } from "@agent/protocol";

type RendererTarget =
  | {
      kind: "url";
      value: URL;
    }
  | {
      kind: "file";
      value: string;
    };

function getRendererTarget(): RendererTarget {
  if (app.isPackaged || process.env.ASTER_START_MODE === "preview") {
    return {
      kind: "file",
      value: app.isPackaged ? path.join(app.getAppPath(), "renderer/index.html")
        : path.resolve(app.getAppPath(), "../web/dist/index.html")
    };
  }
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173";

  if (rendererUrl !== undefined && rendererUrl.length > 0) {
    const parsedUrl = new URL(rendererUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("ELECTRON_RENDERER_URL must use HTTP(S).");
    }

    return {
      kind: "url",
      value: parsedUrl
    };
  }

  throw new Error("Development renderer URL is empty. Run pnpm dev; use pnpm preview for static builds.");
}

function isAllowedNavigation(target: RendererTarget, navigationUrl: string): boolean {
  try {
    const destination = new URL(navigationUrl);

    if (target.kind === "url") {
      return destination.origin === target.value.origin;
    }

    const allowedFile = pathToFileURL(target.value);

    return (
      destination.protocol === "file:" &&
      destination.hostname === allowedFile.hostname &&
      destination.pathname === allowedFile.pathname &&
      destination.search.length === 0
    );
  } catch {
    return false;
  }
}

function denyPermissionRequest(
  _webContents: WebContents,
  _permission: string,
  callback: (permissionGranted: boolean) => void
): void {
  callback(false);
}

function denyPermissionCheck(): boolean {
  return false;
}

export function externalHttpUrl(value: string): string | null {
  if (!/^https?:\/\//iu.test(value) || value.includes("\\")
    || Array.from(value).some((character) => character.charCodeAt(0) < 32)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.href;
  } catch {
    return null;
  }
}

export function getNativeOverlayUrl(target: RendererTarget): string {
  return target.kind === "url"
    ? new URL("native-overlay.html", target.value).href
    : pathToFileURL(path.join(path.dirname(target.value), "native-overlay.html")).href;
}

export function applyRendererSecurityPolicy(
  window: BrowserWindow,
  nativeOverlay?: { allowWindow(url: string): WindowOpenHandlerResponse },
): RendererTarget {
  const target = getRendererTarget();
  const nativeOverlayUrl = getNativeOverlayUrl(target);
  const denyUnexpectedNavigation = (event: Electron.Event, navigationUrl: string): void => {
    if (!isAllowedNavigation(target, navigationUrl)) {
      event.preventDefault();
    }
  };

  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (nativeOverlay !== undefined && frameName === NATIVE_OVERLAY_FRAME_NAME && url === nativeOverlayUrl) {
      return nativeOverlay.allowWindow(url);
    }
    const external = externalHttpUrl(url);
    if (external !== null) {
      void shell.openExternal(external).catch(() => {
        console.warn("无法在系统浏览器中打开网页链接。");
      });
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", denyUnexpectedNavigation);
  window.webContents.on("will-redirect", denyUnexpectedNavigation);
  window.webContents.session.setPermissionCheckHandler(denyPermissionCheck);
  window.webContents.session.setPermissionRequestHandler(denyPermissionRequest);

  return target;
}

export async function loadRenderer(
  window: BrowserWindow,
  target: RendererTarget
): Promise<void> {
  if (target.kind === "url") {
    await window.loadURL(target.value.href);
    return;
  }

  await window.loadFile(target.value);
}
