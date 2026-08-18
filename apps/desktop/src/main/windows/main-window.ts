import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type WebPreferences
} from "electron";
import path from "node:path";

const WINDOW_BACKGROUND_COLOR = "#18181b";
const WINDOW_ASPECT_RATIO = 4 / 3;
const WINDOW_MIN_HEIGHT = 720;
const WINDOW_MIN_WIDTH = 960;
const WINDOW_START_HEIGHT = 1080;
const WINDOW_START_WIDTH = 1440;

/**
 * Electron's legacy remote module is intentionally disabled. Renderer code can
 * only reach the named API exposed by the preload script.
 */
type SecuredWebPreferences = WebPreferences & {
  enableRemoteModule: false;
};

function getPreloadPath(): string {
  return path.resolve(__dirname, "../preload/index.cjs");
}

export function createMainWindow(): BrowserWindow {
  const webPreferences: SecuredWebPreferences = {
    contextIsolation: true,
    enableRemoteModule: false,
    nodeIntegration: false,
    preload: getPreloadPath(),
    sandbox: true,
    webviewTag: false,
    webSecurity: true
  };

  const options: BrowserWindowConstructorOptions = {
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    frame: false,
    height: WINDOW_START_HEIGHT,
    minHeight: WINDOW_MIN_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    show: false,
    title: "Agent Workbench",
    width: WINDOW_START_WIDTH,
    webPreferences
  };

  if (process.platform === "darwin") {
    options.titleBarStyle = "hiddenInset";
  }

  const window = new BrowserWindow(options);
  window.setAspectRatio(WINDOW_ASPECT_RATIO);

  return window;
}
