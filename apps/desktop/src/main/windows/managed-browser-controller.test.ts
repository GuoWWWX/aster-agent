import { type BrowserWindow, type MenuItemConstructorOptions } from "electron";
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

    public constructor() {
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
} from "./managed-browser-controller.js";

function createFakePage() {
  let stateListener: (() => void) | undefined;
  let errorListener: ((message: string) => void) | undefined;
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
    emitState: () => stateListener?.(),
    findInPage: vi.fn(),
    forward: vi.fn(),
    getDownloads: vi.fn(() => []),
    getHistory: vi.fn(() => []),
    getState: vi.fn(() => state),
    load: vi.fn((url: string) => {
      state.url = url;
      return Promise.resolve();
    }),
    onError: vi.fn((listener: (message: string) => void) => {
      errorListener = listener;
      return vi.fn();
    }),
    onStateChanged: vi.fn((listener: () => void) => {
      stateListener = listener;
      return vi.fn();
    }),
    openDevTools: vi.fn(),
    print: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    saveScreenshot: vi.fn(() => Promise.resolve()),
    setAskForDownloadLocation: vi.fn(),
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
    defaultZoomPercent: 100,
    searchEngine: "google",
    version: 1,
    ...overrides,
  };
}

describe("ManagedBrowserController", () => {
  beforeEach(() => {
    electronMocks.loadOverlayUrl.mockReset();
    electronMocks.loadOverlayUrl.mockResolvedValue(undefined);
    electronMocks.overlayViews.length = 0;
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
    overlay.webContents.executeJavaScript.mockResolvedValueOnce("aster-browser-menu:screenshot");
    overlay.webContents.emit("console-message", {
      message: "aster-browser-menu-action",
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
