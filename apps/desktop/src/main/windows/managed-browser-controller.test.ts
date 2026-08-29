import { type BrowserWindow } from "electron";
import type { ManagedBrowserEvent } from "@agent/protocol";
import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const popup = vi.fn();
  return {
    buildFromTemplate: vi.fn(() => ({ popup })),
    popup,
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  };
});

vi.mock("electron", () => ({
  dialog: { showMessageBox: electronMocks.showMessageBox },
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
  WebContentsView: class {},
}));

import {
  ManagedBrowserController,
  normalizeManagedBrowserUrl,
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
    forward: vi.fn(),
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
    reload: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    setZoomPercent: vi.fn((zoomPercent: number) => {
      state.zoomPercent = zoomPercent;
    }),
    stop: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
}

describe("ManagedBrowserController", () => {
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
    expect(() => resolveManagedBrowserAddress("file:///C:/secret.txt")).toThrow("只允许");
  });

  it("owns the page lifecycle, clamps renderer bounds and emits state", async () => {
    const page = createFakePage();
    const window = {
      getContentSize: () => [1_200, 800] as [number, number],
      isDestroyed: () => false,
    } as unknown as BrowserWindow;
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => ({ defaultZoomPercent: 125, version: 1 }) },
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

  it("routes zoom and browser menu commands to the owned page", async () => {
    const page = createFakePage();
    const window = {
      getContentSize: () => [1_200, 800] as [number, number],
      isDestroyed: () => false,
    } as unknown as BrowserWindow;
    const controller = new ManagedBrowserController(
      () => window,
      { getConfiguration: () => ({ defaultZoomPercent: 100, version: 1 }) },
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
    await controller.command({ command: "showMenu", sessionId: session.sessionId });

    expect(page.zoomIn).toHaveBeenCalledOnce();
    expect(page.capture).toHaveBeenCalledOnce();
    expect(page.zoomOut).toHaveBeenCalledOnce();
    expect(page.setZoomPercent).toHaveBeenLastCalledWith(100);
    expect(page.print).toHaveBeenCalledOnce();
    expect(page.openDevTools).toHaveBeenCalledOnce();
    expect(page.clearBrowsingData).toHaveBeenCalledOnce();
    expect(electronMocks.buildFromTemplate).toHaveBeenCalledOnce();
    expect(electronMocks.popup).toHaveBeenCalledWith({ window });
  });
});
