import { type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import type { BrowserConfiguration, ManagedBrowserEvent } from "@agent/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const popup = vi.fn();
  const templates: unknown[] = [];
  const overlayViews: unknown[] = [];
  const loadOverlayUrl = vi.fn((url: string): Promise<void> => {
    void url;
    return Promise.resolve();
  });
  return {
    backgroundWebContentsDestroyed: false,
    backgroundWindowOptions: [] as unknown[],
    backgroundContents: [] as unknown[],
    viewOptions: [] as unknown[],
    backgroundNativeCalls: [] as string[],
    backgroundNativeCommands: [] as { method: string; parameters: unknown }[],
    backgroundColors: [] as string[],
    destroyBackgroundWindow: vi.fn(),
    getPath: vi.fn(() => "C:\\Users\\test\\Downloads"),
    buildFromTemplate: vi.fn((template: unknown) => {
      templates.push(template);
      return { popup };
    }),
    popup,
    nativeTheme: { shouldUseDarkColors: false, themeSource: "system" },
    loadOverlayUrl,
    openPath: vi.fn(() => Promise.resolve("")),
    overlayViews,
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    showItemInFolder: vi.fn(),
    templates,
  };
});

vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  BrowserWindow: class {
    public readonly setBackgroundColor = vi.fn((color: string) => { electronMocks.backgroundColors.push(color); });
    public readonly setContentSize = vi.fn();
    public readonly destroy = electronMocks.destroyBackgroundWindow;
    public readonly webContents;

    public constructor(options: unknown) {
      electronMocks.backgroundWindowOptions.push(options);
      let url = "";
      let attached = false;
      this.webContents = {
        debugger: {
          attach: vi.fn(() => { attached = true; }),
          detach: vi.fn(() => { attached = false; }),
          isAttached: () => attached,
          sendCommand: vi.fn((method: string, parameters: unknown) => {
            if (method === "Emulation.setDeviceMetricsOverride" && url === "") throw new Error("Renderer not initialized");
            electronMocks.backgroundNativeCalls.push(method);
            electronMocks.backgroundNativeCommands.push({ method, parameters });
            return Promise.resolve();
          }),
        },
        executeJavaScript: vi.fn(() => Promise.resolve()),
        getTitle: () => "Background",
        getURL: () => url,
        isDestroyed: () => electronMocks.backgroundWebContentsDestroyed,
        isLoading: () => false,
        loadURL: vi.fn((value: string) => {
          url = value;
          electronMocks.backgroundNativeCalls.push(`load:${value}`);
          return Promise.resolve();
        }),
        navigationHistory: { canGoBack: () => false, canGoForward: () => false },
        on: vi.fn(),
        session: { on: vi.fn(), removeListener: vi.fn(() => {
          if (electronMocks.backgroundWebContentsDestroyed) throw new Error("WebContents destroyed");
        }), setPermissionRequestHandler: vi.fn() },
        setWindowOpenHandler: vi.fn(),
        setZoomFactor: vi.fn(),
      };
      electronMocks.backgroundContents.push(this.webContents);
    }
  },
  dialog: { showMessageBox: electronMocks.showMessageBox },
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
  nativeTheme: electronMocks.nativeTheme,
  session: { fromPartition: vi.fn(() => ({ clearData: vi.fn(() => Promise.resolve()) })) },
  shell: {
    openPath: electronMocks.openPath,
    showItemInFolder: electronMocks.showItemInFolder,
  },
  WebContentsView: class {
    public readonly setBackgroundColor = vi.fn();
    public readonly setBounds = vi.fn();
    public readonly setVisible = vi.fn();
    public readonly webContents;

    public constructor(options?: unknown) {
      electronMocks.viewOptions.push(options);
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      const addHandler = (event: string, handler: (...args: unknown[]) => void): void => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      };
      const emit = (event: string, ...args: unknown[]): void => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
      };
      this.webContents = {
        close: vi.fn(),
        executeJavaScript: vi.fn(() => Promise.resolve("")),
        focus: vi.fn(),
        isDestroyed: vi.fn(() => false),
        emit,
        loadURL: vi.fn((url: string) => electronMocks.loadOverlayUrl(url).then(() => emit("did-finish-load"))),
        on: vi.fn(addHandler),
        once: vi.fn(addHandler),
        setWindowOpenHandler: vi.fn(),
      };
      electronMocks.overlayViews.push(this);
    }
  },
}));

import {
  ManagedBrowserController,
  managedBrowserZoomFactor,
  normalizeManagedBrowserUrl,
  reloadManagedBrowserPage,
  resolveManagedBrowserAddress,
  resolveBrowserDownloadPath,
} from "./managed-browser-controller.js";

function createFakePage() {
  let stateListener: (() => void) | undefined;
  let errorListener: ((message: string) => void) | undefined;
  let findResultListener: ((result: { activeMatchOrdinal: number; matches: number }) => void) | undefined;
  const state = {
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    title: "Example",
    url: "https://example.com/",
    zoomPercent: 100,
  };
  return {
    back: vi.fn(),
    capture: vi.fn(() => Promise.resolve({
      data: "c25hcHNob3Q=",
      height: 600,
      mimeType: "image/jpeg" as const,
      width: 900,
    })),
    clearBrowsingData: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
    emitError: (message: string) => errorListener?.(message),
    emitFindResult: (result: { activeMatchOrdinal: number; matches: number }) => findResultListener?.(result),
    emitState: () => stateListener?.(),
    findInPage: vi.fn(),
    forward: vi.fn(),
    getDownloads: vi.fn(() => []),
    getHistory: vi.fn(() => []),
    getState: vi.fn(() => state),
    interact: vi.fn(() => Promise.resolve()),
    load: vi.fn((url: string) => {
      state.url = url;
      return Promise.resolve();
    }),
    onError: vi.fn((listener: (message: string) => void) => {
      errorListener = listener;
      return vi.fn();
    }),
    onFindResult: vi.fn((listener: (result: { activeMatchOrdinal: number; matches: number }) => void) => {
      findResultListener = listener;
      return vi.fn();
    }),
    onStateChanged: vi.fn((listener: () => void) => {
      stateListener = listener;
      return vi.fn();
    }),
    observe: vi.fn(() => Promise.resolve({
      elements: [],
      text: "Example",
      textTruncated: false,
      title: "Example",
      url: "https://example.com/",
      viewport: { height: 600, width: 900 },
    })),
    openDevTools: vi.fn(),
    print: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    saveScreenshot: vi.fn(() => Promise.resolve()),
    setAskForDownloadLocation: vi.fn(),
    setDownloadDirectory: vi.fn(),
    setSavePasswords: vi.fn(),
    setBounds: vi.fn(),
    setColorScheme: vi.fn(() => Promise.resolve()),
    setVisible: vi.fn(),
    setZoomPercent: vi.fn((zoomPercent: number) => {
      state.zoomPercent = zoomPercent;
    }),
    showStartPage: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    stopFindInPage: vi.fn(),
    toggleDeviceToolbar: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
}

function createFakeWindow(): BrowserWindow {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getContentSize: () => [1_200, 800] as [number, number],
    isDestroyed: () => false,
  } as unknown as BrowserWindow;
}

function browserConfiguration(
  overrides: Partial<BrowserConfiguration> = {},
): BrowserConfiguration {
  return {
    askForDownloadLocation: false,
    downloadDirectory: "",
    savePasswords: true,
    defaultZoomPercent: 100,
    searchEngine: "google",
    version: 1,
    ...overrides,
  };
}

it("downloads into the configured directory and avoids overwriting reserved names", () => {
  const directory = path.join(os.tmpdir(), "aster-download-test");
  const first = resolveBrowserDownloadPath("../report.pdf", [], directory);
  expect(first).toBe(path.join(directory, "report.pdf"));
  expect(resolveBrowserDownloadPath("report.pdf", [{ fileName: "report.pdf", savePath: first, receivedBytes: 0, totalBytes: 0, state: "progressing" }], directory))
    .toBe(path.join(directory, "report (1).pdf"));
});

describe("ManagedBrowserController", () => {
  it.each(["reload", "crash"])("releases renderer-owned pages on %s and ignores their late bounds without stopping background work", async (cause) => {
    const contents = new EventEmitter();
    const window = Object.assign(createFakeWindow(), { webContents: contents });
    const foreground = createFakePage();
    const background = createFakePage();
    const controller = new ManagedBrowserController(() => window,
      { getConfiguration: () => browserConfiguration() },
      vi.fn().mockReturnValueOnce(foreground).mockReturnValueOnce(background));
    const onError = vi.fn();
    const detach = controller.attachRenderer(window, onError);
    const onClose = vi.fn();
    const session = await controller.open({}, { onClose });
    const worker = await controller.open({}, { background: { width: 800, height: 600 } });
    const bounds = { sessionId: session.sessionId, visible: true, x: 500, y: 100, width: 700, height: 600 };
    controller.setBounds(bounds);
    contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(foreground.close).not.toHaveBeenCalled();
    if (cause === "reload") contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    else contents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(foreground.close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    controller.setBounds(bounds);
    expect(foreground.setVisible).toHaveBeenCalledTimes(1);
    await controller.capture({ sessionId: worker.sessionId });
    expect(background.capture).toHaveBeenCalledOnce();
    expect(background.close).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    detach();
    expect(contents.eventNames()).toEqual([]);
    controller.dispose();
  });

  it("releases every foreground page even when one fails to close", async () => {
    const contents = new EventEmitter();
    const window = Object.assign(createFakeWindow(), { webContents: contents });
    const first = createFakePage();
    const second = createFakePage();
    const error = new Error("native close failed");
    first.close.mockImplementationOnce(() => { throw error; });
    const controller = new ManagedBrowserController(() => window,
      { getConfiguration: () => browserConfiguration() },
      vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second));
    const onError = vi.fn();
    const detach = controller.attachRenderer(window, onError);
    await controller.open({});
    await controller.open({});
    contents.emit("render-process-gone");
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
    detach();
    controller.dispose();
  });

  it.each([true, false])("preserves authored preview colors without changing ordinary browser dark mode (isolated=%s)", async (isolated) => {
    electronMocks.nativeTheme.shouldUseDarkColors = true;
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() });
    try {
      const session = await controller.open({ url: "http://127.0.0.1:1234/token/index.html" }, {
        isolated, background: { width: 620, height: 900 },
      });
      await controller.navigate({ sessionId: session.sessionId, url: "http://127.0.0.1:1234/token/next.html" });
      const commands = electronMocks.backgroundNativeCommands;
      expect(commands.filter(call => call.method === "Emulation.setAutoDarkModeOverride").map(call => call.parameters))
        .toEqual([{ enabled: !isolated }, { enabled: !isolated }, { enabled: !isolated }]);
      expect(commands.filter(call => call.method === "Emulation.setEmulatedMedia").at(-1)?.parameters)
        .toEqual({ features: [{ name: "prefers-color-scheme", value: "dark" }] });
      const background = isolated ? "#ffffff" : "#171717";
      expect(electronMocks.backgroundColors).toEqual([background, background]);
    } finally {
      controller.dispose();
      electronMocks.nativeTheme.shouldUseDarkColors = false;
    }
  });
  beforeEach(() => {
    electronMocks.backgroundColors.length = 0;
    electronMocks.backgroundNativeCommands.length = 0;
    electronMocks.backgroundWindowOptions.length = 0;
    electronMocks.backgroundContents.length = 0;
    electronMocks.viewOptions.length = 0;
    electronMocks.backgroundNativeCalls.length = 0;
    electronMocks.backgroundWebContentsDestroyed = false;
    electronMocks.destroyBackgroundWindow.mockClear();
    electronMocks.loadOverlayUrl.mockReset();
    electronMocks.loadOverlayUrl.mockResolvedValue(undefined);
    electronMocks.overlayViews.length = 0;
  });

  it("initializes the native renderer before applying the background viewport and reapplies it after navigation", async () => {
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() });
    const session = await controller.open({ url: "https://example.test" }, { background: { width: 620, height: 900 } });
    expect(electronMocks.backgroundWindowOptions).toHaveLength(1);
    const options = electronMocks.backgroundWindowOptions[0];
    expect(options).toMatchObject({ show: false, webPreferences: { nodeIntegration: false, sandbox: true } });
    expect(options).not.toHaveProperty("webPreferences.offscreen", true);
    const calls = electronMocks.backgroundNativeCalls;
    expect(calls.indexOf("Emulation.setDeviceMetricsOverride")).toBeGreaterThan(calls.indexOf("load:about:blank"));
    expect(calls.lastIndexOf("Emulation.setDeviceMetricsOverride")).toBeGreaterThan(calls.indexOf("load:https://example.test/"));
    controller.close({ sessionId: session.sessionId });
    controller.dispose();
    expect(electronMocks.destroyBackgroundWindow).toHaveBeenCalledOnce();
  });

  it("releases a managed session after its native contents have already been destroyed", async () => {
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() });
    await controller.open({ url: "https://example.test" }, { background: { width: 620, height: 900 } });
    electronMocks.backgroundWebContentsDestroyed = true;
    expect(() => controller.dispose()).not.toThrow();
  });

  it("reveals the existing background contents without creating or loading another page", async () => {
    const window = createFakeWindow();
    const addView = vi.spyOn(window.contentView, "addChildView");
    const removeView = vi.spyOn(window.contentView, "removeChildView");
    const controller = new ManagedBrowserController(() => window,
      { getConfiguration: () => browserConfiguration() });
    const session = await controller.open({ url: "https://example.test" }, { background: { width: 620, height: 900 } });
    expect(addView).not.toHaveBeenCalled();
    const loads = electronMocks.backgroundNativeCalls.filter(call => call.startsWith("load:"));
    controller.setBounds({ sessionId: session.sessionId, x: 10, y: 20, width: 460, height: 600, visible: true });
    controller.setBounds({ sessionId: session.sessionId, x: 10, y: 20, width: 460, height: 600, visible: false });
    controller.setBounds({ sessionId: session.sessionId, x: 10, y: 20, width: 460, height: 600, visible: true });
    expect(electronMocks.viewOptions).toHaveLength(1);
    expect(electronMocks.viewOptions[0]).toHaveProperty("webContents", electronMocks.backgroundContents[0]);
    expect(addView).toHaveBeenCalledOnce();
    expect(electronMocks.backgroundWindowOptions).toHaveLength(1);
    expect(electronMocks.backgroundNativeCalls.filter(call => call.startsWith("load:"))).toEqual(loads);
    controller.close({ sessionId: session.sessionId });
    expect(removeView).toHaveBeenCalledOnce();
    expect(electronMocks.destroyBackgroundWindow).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("closes remaining managed pages when one native close fails", async () => {
    const first = createFakePage(); const second = createFakePage();
    const onClose = vi.fn();
    first.close.mockImplementationOnce(() => { throw new Error("native close failed"); });
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() }, factory);
    await controller.open({}, { onClose }); await controller.open({});
    expect(() => controller.dispose()).toThrow(AggregateError);
    expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("gives background pages an isolated fixed viewport without revealing a view", async () => {
    const page = createFakePage();
    const factory = vi.fn<NonNullable<ConstructorParameters<typeof ManagedBrowserController>[2]>>(() => page);
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration({ defaultZoomPercent: 150 }) }, factory);
    const abort = new AbortController();
    const session = await controller.open({ url: "https://example.test" }, {
      background: { width: 620, height: 900 }, signal: abort.signal,
    });
    expect(factory.mock.calls[0]?.[4]).toEqual({ width: 620, height: 900 });
    expect(page.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 620, height: 900 });
    expect(page.setSavePasswords).toHaveBeenCalledWith(false);
    expect(page.setZoomPercent).toHaveBeenLastCalledWith(100);
    controller.setBounds({ sessionId: session.sessionId, x: 0, y: 0, width: 800, height: 600, visible: true });
    expect(page.setVisible).toHaveBeenLastCalledWith(true);
    controller.setBounds({ sessionId: session.sessionId, x: 0, y: 0, width: 800, height: 600, visible: false });
    expect(page.setVisible).toHaveBeenLastCalledWith(false);
    await controller.capture({ sessionId: session.sessionId });
    expect(page.capture).toHaveBeenCalledOnce();
    abort.abort();
    expect(page.close).toHaveBeenCalledOnce();
    controller.dispose();
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("releases a background page when opening fails or is cancelled during loading", async () => {
    const page = createFakePage();
    const controller = new ManagedBrowserController(() => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() }, () => page);
    page.load.mockRejectedValueOnce(new Error("Page unavailable"));
    await expect(controller.open({ url: "https://example.test" }, { background: { width: 620, height: 900 } }))
      .rejects.toThrow("Page unavailable");
    expect(page.close).toHaveBeenCalledTimes(1);
    const abort = new AbortController();
    let finishLoad: () => void = () => {};
    page.load.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishLoad = resolve;
      abort.abort();
    }));
    const opened = controller.open({ url: "https://example.test" }, {
      background: { width: 620, height: 900 }, signal: abort.signal,
    });
    for (let index = 0; index < 5; index++) await Promise.resolve();
    finishLoad();
    await expect(opened).rejects.toMatchObject({ name: "AbortError" });
    controller.dispose();
    expect(page.close).toHaveBeenCalledTimes(2);
  });

  it("treats the previous 80% page scale as the new 100% baseline", () => {
    expect(managedBrowserZoomFactor(100)).toBe(0.8);
    expect(managedBrowserZoomFactor(125)).toBe(1);
  });

  it("rebuilds the custom start page when about:blank is refreshed", async () => {
    const nativeReload = vi.fn();
    const restoreStartPage = vi.fn(() => Promise.resolve());

    await reloadManagedBrowserPage("about:blank", nativeReload, restoreStartPage);

    expect(restoreStartPage).toHaveBeenCalledOnce();
    expect(nativeReload).not.toHaveBeenCalled();

    await reloadManagedBrowserPage("https://example.com/", nativeReload, restoreStartPage);

    expect(nativeReload).toHaveBeenCalledOnce();
    expect(restoreStartPage).toHaveBeenCalledOnce();
  });

  it("normalizes only credential-free HTTP and HTTPS URLs", () => {
    expect(normalizeManagedBrowserUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(() => normalizeManagedBrowserUrl("file:///C:/secret.txt")).toThrow("只允许");
    expect(() => normalizeManagedBrowserUrl("https://user:secret@example.com")).toThrow("不含凭据");
  });

  it("opens host-like input as an address and plain text with Google Search", () => {
    expect(resolveManagedBrowserAddress("example.com/docs")).toBe("https://example.com/docs");
    expect(resolveManagedBrowserAddress("localhost:5173")).toBe("https://localhost:5173/");
    expect(resolveManagedBrowserAddress("chrome")).toBe("https://www.google.com/search?q=chrome");
    expect(resolveManagedBrowserAddress("谷歌 浏览器")).toBe(
      "https://www.google.com/search?q=%E8%B0%B7%E6%AD%8C+%E6%B5%8F%E8%A7%88%E5%99%A8",
    );
    expect(resolveManagedBrowserAddress("privacy browser", "duckduckgo"))
      .toBe("https://duckduckgo.com/?q=privacy+browser");
    expect(() => resolveManagedBrowserAddress("file:///C:/secret.txt")).toThrow("只允许");
  });

  it("creates isolated HTML pages without password integration and disposes their owner exactly once", async () => {
    const page = createFakePage();
    const window = createFakeWindow();
    const factory = vi.fn(() => page);
    const onClose = vi.fn();
    const controller = new ManagedBrowserController(() => window, { getConfiguration: () => browserConfiguration() }, factory);
    const session = await controller.open({ url: "http://127.0.0.1:1234/token/demo.html" }, { isolated: true, onClose });
    expect(factory).toHaveBeenCalledWith(window, expect.any(Object), undefined, true, undefined);
    controller.close({ sessionId: session.sessionId });
    controller.dispose();
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens a new user browser tab without navigating to a default website", async () => {
    const page = createFakePage();
    const window = createFakeWindow();
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );

    await controller.open({});

    expect(page.load).not.toHaveBeenCalled();
    expect(page.setColorScheme).toHaveBeenCalledWith("light");
    expect(page.showStartPage).toHaveBeenCalledOnce();
    expect(page.showStartPage.mock.invocationCallOrder[0])
      .toBeLessThan(page.setColorScheme.mock.invocationCallOrder[0]!);
    expect(page.setZoomPercent).toHaveBeenCalledWith(100);
  });

  it("owns the page lifecycle, clamps renderer bounds and emits state", async () => {
    const page = createFakePage();
    const window = createFakeWindow();
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => browserConfiguration({
        askForDownloadLocation: true,
        defaultZoomPercent: 125,
        searchEngine: "duckduckgo",
      }) },
      () => page,
    );
    const events: ManagedBrowserEvent[] = [];
    controller.onEvent((event) => events.push(event));

    const session = await controller.open({ url: "example.com" });
    controller.setBounds({
      height: 900,
      sessionId: session.sessionId,
      visible: true,
      width: 900,
      x: 500,
      y: 20,
    });
    await controller.command({ command: "reload", sessionId: session.sessionId });
    page.emitState();
    page.emitError("navigation failed");
    controller.close({ sessionId: session.sessionId });

    expect(page.load).toHaveBeenCalledWith("https://example.com/");
    expect(page.setColorScheme.mock.invocationCallOrder[0])
      .toBeLessThan(page.load.mock.invocationCallOrder[0]!);
    expect(page.setAskForDownloadLocation).toHaveBeenCalledWith(true);
    expect(page.setZoomPercent).toHaveBeenCalledWith(125);
    expect(page.setBounds).toHaveBeenCalledWith({ height: 764, width: 700, x: 500, y: 36 });
    expect(page.setVisible).toHaveBeenCalledWith(true);
    expect(page.reload).toHaveBeenCalledOnce();
    expect(events).toEqual([
      {
        session: {
          ...page.getState(),
          sessionId: session.sessionId,
        },
        type: "state",
      },
      { message: "navigation failed", sessionId: session.sessionId, type: "error" },
    ]);
    expect(page.close).toHaveBeenCalledOnce();

    expect(() => controller.setBounds({
      height: 600,
      sessionId: session.sessionId,
      visible: true,
      width: 800,
      x: 400,
      y: 80,
    })).not.toThrow();
    expect(page.setBounds).toHaveBeenCalledOnce();
  });

  it("applies download settings and clears data across open tabs", async () => {
    const pages = [createFakePage(), createFakePage()];
    const controller = new ManagedBrowserController(
      () => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() },
      () => pages.shift()!,
    );
    const firstPage = pages[0]!;
    const secondPage = pages[1]!;

    await controller.open({});
    await controller.open({});
    controller.applyConfiguration(browserConfiguration({ askForDownloadLocation: true }));
    await controller.clearBrowsingData();

    expect(firstPage.setAskForDownloadLocation).toHaveBeenLastCalledWith(true);
    expect(secondPage.setAskForDownloadLocation).toHaveBeenLastCalledWith(true);
    expect(firstPage.clearBrowsingData).toHaveBeenCalledOnce();
    expect(secondPage.clearBrowsingData).toHaveBeenCalledOnce();
  });

  it("routes zoom and browser menu commands to the owned page", async () => {
    electronMocks.buildFromTemplate.mockClear();
    electronMocks.popup.mockClear();
    electronMocks.templates.length = 0;
    const page = createFakePage();
    const window = createFakeWindow();
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );
    const session = await controller.open({});

    await expect(controller.capture({ sessionId: session.sessionId })).resolves.toEqual({
      data: "c25hcHNob3Q=",
      height: 600,
      mimeType: "image/jpeg",
      width: 900,
    });

    await controller.command({ command: "zoomIn", sessionId: session.sessionId });
    await controller.command({ command: "zoomOut", sessionId: session.sessionId });
    await controller.command({ command: "resetZoom", sessionId: session.sessionId });
    await controller.command({ command: "print", sessionId: session.sessionId });
    await controller.command({ command: "openDevTools", sessionId: session.sessionId });
    await controller.command({ command: "clearBrowsingData", sessionId: session.sessionId });
    await controller.command({ command: "showMenu", sessionId: session.sessionId, x: 1_180, y: 92 });
    await controller.command({ command: "showDownloads", sessionId: session.sessionId, x: 1_148, y: 92 });
    await controller.command({
      colorScheme: "dark",
      command: "setColorScheme",
      sessionId: session.sessionId,
    });

    expect(page.zoomIn).toHaveBeenCalledOnce();
    expect(page.capture).toHaveBeenCalledOnce();
    expect(page.zoomOut).toHaveBeenCalledOnce();
    expect(page.setZoomPercent).toHaveBeenLastCalledWith(100);
    expect(page.print).toHaveBeenCalledOnce();
    expect(page.openDevTools).toHaveBeenCalledOnce();
    expect(page.clearBrowsingData).toHaveBeenCalledOnce();
    expect(electronMocks.buildFromTemplate).not.toHaveBeenCalled();
    expect(electronMocks.overlayViews).toHaveLength(2);
    const firstOverlay = electronMocks.overlayViews[0] as {
      setBounds: ReturnType<typeof vi.fn>;
    };
    const secondOverlay = electronMocks.overlayViews[1] as {
      setBounds: ReturnType<typeof vi.fn>;
      webContents: { loadURL: ReturnType<typeof vi.fn> };
    };
    expect(firstOverlay.setBounds).toHaveBeenCalledWith({
      height: 352,
      width: 224,
      x: 956,
      y: 96,
    });
    expect(secondOverlay.setBounds).toHaveBeenCalledWith({
      height: 142,
      width: 300,
      x: 848,
      y: 96,
    });
    expect(secondOverlay.webContents.loadURL).toHaveBeenCalledTimes(2);
    expect(secondOverlay.webContents.loadURL.mock.lastCall?.[0]).toContain("data-theme%3D%22dark%22");
    expect(electronMocks.nativeTheme.themeSource).toBe("dark");
    expect(page.setColorScheme).toHaveBeenLastCalledWith("dark");
  });

  it("forwards the bounded browser automation surface to the owned page", async () => {
    const page = createFakePage();
    const controller = new ManagedBrowserController(
      () => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );
    const session = await controller.open({});

    await expect(controller.observe({ sessionId: session.sessionId })).resolves.toMatchObject({
      title: "Example",
      viewport: { height: 600, width: 900 },
    });
    await controller.interact({
      button: "left",
      clickCount: 2,
      kind: "click",
      sessionId: session.sessionId,
      x: 100,
      y: 120,
    });
    controller.back({ sessionId: session.sessionId });
    controller.forward({ sessionId: session.sessionId });
    await controller.reload({ sessionId: session.sessionId });
    controller.stop({ sessionId: session.sessionId });

    expect(page.interact).toHaveBeenCalledWith({
      button: "left",
      clickCount: 2,
      kind: "click",
      sessionId: session.sessionId,
      x: 100,
      y: 120,
    });
    expect(page.back).toHaveBeenCalledOnce();
    expect(page.forward).toHaveBeenCalledOnce();
    expect(page.reload).toHaveBeenCalledOnce();
    expect(page.stop).toHaveBeenCalledOnce();
  });

  it("handles page-focus find and global-search shortcuts", async () => {
    const page = createFakePage();
    const window = createFakeWindow();
    let shortcuts: { onFind: () => void; onGlobalSearch: () => void } | undefined;
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => browserConfiguration() },
      (_window, nextShortcuts) => {
        shortcuts = nextShortcuts;
        return page;
      },
    );
    const events: ManagedBrowserEvent[] = [];
    controller.onEvent((event) => events.push(event));
    const session = await controller.open({});
    controller.setBounds({
      height: 600,
      sessionId: session.sessionId,
      visible: true,
      width: 800,
      x: 400,
      y: 100,
    });

    shortcuts?.onFind();
    shortcuts?.onGlobalSearch();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(electronMocks.overlayViews).toHaveLength(1);
    const overlay = electronMocks.overlayViews[0] as { setBounds: ReturnType<typeof vi.fn> };
    expect(overlay.setBounds).toHaveBeenCalledWith({ height: 56, width: 440, x: 760, y: 104 });
    expect(events).toContainEqual({ sessionId: session.sessionId, type: "openGlobalSearch" });
  });

  it("ignores a superseded menu data URL failure while the overlay rerenders", async () => {
    let rejectFirstLoad: ((reason: unknown) => void) | undefined;
    electronMocks.loadOverlayUrl
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        rejectFirstLoad = reject;
      }))
      .mockResolvedValue(undefined);
    const page = createFakePage();
    const controller = new ManagedBrowserController(
      () => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );
    const errors: string[] = [];
    controller.onEvent((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    const session = await controller.open({});

    await controller.command({ command: "showMenu", sessionId: session.sessionId, x: 1_180, y: 92 });
    await controller.command({
      colorScheme: "dark",
      command: "setColorScheme",
      sessionId: session.sessionId,
    });
    expect(electronMocks.loadOverlayUrl).toHaveBeenCalledTimes(2);
    rejectFirstLoad?.(new Error("ERR_FAILED (-2) loading data:text/html"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(errors).toEqual([]);
  });

  it("treats cancelling a screenshot menu action as a normal outcome", async () => {
    const page = createFakePage();
    page.saveScreenshot.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const controller = new ManagedBrowserController(
      () => createFakeWindow(),
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );
    const errors: string[] = [];
    controller.onEvent((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    const session = await controller.open({});

    await controller.command({ command: "showMenu", sessionId: session.sessionId, x: 1_180, y: 92 });
    const overlay = electronMocks.overlayViews[0] as {
      webContents: {
        emit: (event: string, ...args: unknown[]) => void;
        executeJavaScript: ReturnType<typeof vi.fn>;
      };
    };
    overlay.webContents.emit("console-message", {
      message: "aster-browser-menu-action:aster-browser-menu:screenshot",
      sourceId: "data:text/html;charset=utf-8,menu",
    });
    await vi.waitFor(() => expect(page.saveScreenshot).toHaveBeenCalledOnce());

    expect(errors).toEqual([]);
  });

  it("shows workspace menus above the browser view and emits the selected action", async () => {
    electronMocks.buildFromTemplate.mockClear();
    electronMocks.popup.mockClear();
    electronMocks.templates.length = 0;
    const page = createFakePage();
    const window = createFakeWindow();
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => browserConfiguration() },
      () => page,
    );
    const events: ManagedBrowserEvent[] = [];
    controller.onEvent((event) => events.push(event));
    const session = await controller.open({});

    await controller.command({
      canCreateSideChat: true,
      canOpenGitReview: false,
      canOpenTerminal: true,
      command: "showWorkspaceAddMenu",
      sessionId: session.sessionId,
      x: 800,
      y: 72,
    });
    const addTemplate = electronMocks.templates[0] as
      | MenuItemConstructorOptions[]
      | undefined;
    (addTemplate?.[3]?.click as (() => void) | undefined)?.();

    expect(addTemplate?.map((item) => item.label)).toEqual([
      "审阅",
      "终端",
      "浏览器",
      "文件",
      "侧边聊天",
    ]);
    expect(addTemplate?.[0]?.enabled).toBe(false);
    expect(electronMocks.popup).toHaveBeenLastCalledWith({ window, x: 800, y: 72 });
    expect(events).toContainEqual({
      action: "openFiles",
      sessionId: session.sessionId,
      type: "workspaceAddMenu",
    });

    await controller.command({
      canCloseOthers: false,
      command: "showWorkspaceTabMenu",
      sessionId: session.sessionId,
      x: 640,
      y: 58,
    });
    const tabTemplate = electronMocks.templates[1] as
      | MenuItemConstructorOptions[]
      | undefined;
    (tabTemplate?.[2]?.click as (() => void) | undefined)?.();

    expect(tabTemplate?.map((item) => item.label)).toEqual(["关闭", "关闭其他", "关闭全部"]);
    expect(tabTemplate?.[1]?.enabled).toBe(false);
    expect(electronMocks.popup).toHaveBeenLastCalledWith({ window, x: 640, y: 58 });
    expect(events).toContainEqual({
      action: "closeAll",
      sessionId: session.sessionId,
      type: "workspaceTabMenu",
    });
  });
});
