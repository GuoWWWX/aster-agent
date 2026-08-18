import { app, type BrowserWindow, type WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

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

  return {
    kind: "file",
    value: path.resolve(app.getAppPath(), "../web/dist/index.html")
  };
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

export function applyRendererSecurityPolicy(window: BrowserWindow): RendererTarget {
  const target = getRendererTarget();
  const denyUnexpectedNavigation = (event: Electron.Event, navigationUrl: string): void => {
    if (!isAllowedNavigation(target, navigationUrl)) {
      event.preventDefault();
    }
  };

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
