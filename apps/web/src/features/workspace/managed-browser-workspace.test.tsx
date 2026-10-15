// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedBrowserBoundsInput, ManagedBrowserSession } from "@agent/protocol";

import { emitLivePanelResize } from "../../components/layout/live-panel-resize.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient, type AgentClient } from "../../runtime/index.js";
import { createManagedBrowserBoundsDispatcher } from "./managed-browser-bounds-dispatcher.js";
import {
  ManagedBrowserWorkspace,
  type ManagedBrowserWorkspaceMenuRequest,
} from "./managed-browser-workspace.js";

const SESSION: ManagedBrowserSession = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  sessionId: "00000000-0000-4000-8000-000000000001",
  title: "Example",
  url: "https://example.com/",
  zoomPercent: 100,
};

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("innerWidth", 1800);
  vi.stubGlobal("innerHeight", 1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.matches("[data-managed-browser-surface]") ? new DOMRect(600, 100, 800, 600) : new DOMRect();
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderBrowser(
  client: MockAgentClient,
  menuRequest: ManagedBrowserWorkspaceMenuRequest | null = null,
): HTMLDivElement {
  vi.spyOn(client, "commandManagedBrowser").mockResolvedValue();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(
    <TooltipProvider>
      <ManagedBrowserWorkspace
        active
        agentClient={client}
        colorScheme="light"
        initialUrl={SESSION.url}
        menuRequest={menuRequest}
        session={SESSION}
        onSessionChanged={vi.fn()}
        onWorkspaceAddMenuAction={vi.fn()}
        onWorkspaceTabMenuAction={vi.fn()}
      />
    </TooltipProvider>,
  ));
  return container;
}

describe("ManagedBrowserWorkspace", () => {
  it("opens page find with Ctrl+F while the browser toolbar has focus", async () => {
    const client = new MockAgentClient();
    const command = vi.spyOn(client, "commandManagedBrowser").mockResolvedValue(undefined);
    const container = renderBrowser(client);
    const address = container.querySelector<HTMLInputElement>('[aria-label="网址或搜索内容"]');
    if (address === null) throw new Error("Expected browser address input.");

    void act(() => {
      address.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "f",
      }));
    });
    await act(async () => Promise.resolve());

    expect(command).toHaveBeenCalledWith({
      command: "showFind",
      sessionId: SESSION.sessionId,
      x: 1400,
      y: 100,
    });
  });

  it("keeps only the newest pending bounds while a native-view update is in flight", async () => {
    const resolvers: Array<() => void> = [];
    const dispatch = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    const dispatcher = createManagedBrowserBoundsDispatcher(dispatch);
    const bounds = (x: number, width: number): ManagedBrowserBoundsInput => ({
      height: 600,
      sessionId: SESSION.sessionId,
      visible: true,
      width,
      x,
      y: 100,
    });

    dispatcher.push(bounds(900, 900));
    dispatcher.push(bounds(1_000, 800));
    dispatcher.push(bounds(1_100, 700));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith(bounds(900, 900));

    resolvers.shift()?.();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenLastCalledWith(bounds(1_100, 700));

    resolvers.shift()?.();
    await Promise.resolve();
    dispatcher.push(bounds(1_100, 700));
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("uses the committed surface rectangle during a drag instead of predicting it from panel width", async () => {
    const client = new MockAgentClient();
    const setBounds = vi.spyOn(client as AgentClient, "setManagedBrowserBounds").mockResolvedValue();
    const container = renderBrowser(client);
    await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
    const surface = container.querySelector<HTMLElement>("[data-managed-browser-surface]");
    expect(surface).not.toBeNull();
    let bounds = new DOMRect(600, 100, 800, 600);
    Object.defineProperty(surface, "getBoundingClientRect", { value: () => bounds });

    act(() => {
      emitLivePanelResize({ id: "right-workspace", phase: "start", size: 800 });
      bounds = new DOMRect(740, 110, 660, 550);
      emitLivePanelResize({ id: "right-workspace", phase: "move", size: 500 });
    });

    await vi.waitFor(() => expect(setBounds).toHaveBeenCalledWith({
      height: 550,
      sessionId: SESSION.sessionId,
      visible: true,
      width: 660,
      x: 740,
      y: 110,
    }));
    bounds = new DOMRect(750, 120, 650, 530);
    await vi.waitFor(() => expect(setBounds).toHaveBeenLastCalledWith({
      sessionId: SESSION.sessionId, visible: true, x: 750, y: 120, width: 650, height: 530,
    }));
    act(() => { emitLivePanelResize({ id: "right-workspace", phase: "end", size: 500 }); });
  });

  it("hides the native surface while overlapping renderer overlays are open and restores it after the last closes", async () => {
    const client = new MockAgentClient();
    const setBounds = vi.spyOn(client, "setManagedBrowserBounds").mockResolvedValue();
    const openBrowser = vi.spyOn(client, "openManagedBrowser");
    const closeBrowser = vi.spyOn(client, "closeManagedBrowser");
    const navigateBrowser = vi.spyOn(client, "navigateManagedBrowser");
    renderBrowser(client);
    const overlay = (bounds = new DOMRect(900, 80, 300, 200)): HTMLDivElement => {
      const element = document.createElement("div");
      element.dataset.nativeViewOverlay = "";
      element.dataset.state = "open";
      Object.defineProperty(element, "getBoundingClientRect", { value: () => bounds });
      document.body.append(element);
      return element;
    };
    const outside = overlay(new DOMRect(0, 0, 200, 60));
    const closed = overlay();
    closed.dataset.state = "closed";
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    outside.remove(); closed.remove();
    const first = overlay();
    await vi.waitFor(() => expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false })));
    const second = overlay();
    first.remove();
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
    second.remove();
    await vi.waitFor(() => expect(setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true })));
    expect(openBrowser).not.toHaveBeenCalled();
    expect(closeBrowser).not.toHaveBeenCalled();
    expect(navigateBrowser).not.toHaveBeenCalled();
  });

  it("clips native bounds to the visible ancestor content instead of drawing beyond its card", async () => {
    const client = new MockAgentClient();
    const setBounds = vi.spyOn(client, "setManagedBrowserBounds").mockResolvedValue();
    const container = renderBrowser(client);
    const section = container.querySelector<HTMLElement>("[data-managed-browser-workspace]")!;
    section.style.overflow = "hidden";
    section.style.overflowX = "hidden";
    section.style.overflowY = "hidden";
    Object.defineProperty(section, "getBoundingClientRect", { value: () => new DOMRect(650, 120, 500, 400) });
    Object.defineProperties(section, { clientWidth: { value: 500 }, clientHeight: { value: 400 } });
    act(() => { emitLivePanelResize({ id: "right-workspace", phase: "end", size: 800 }); });
    await vi.waitFor(() => expect(setBounds).toHaveBeenLastCalledWith({
      sessionId: SESSION.sessionId, visible: true, x: 650, y: 120, width: 500, height: 400,
    }));
  });

  it("selects the complete address when the address field first receives focus", () => {
    const client = new MockAgentClient();
    const commandManagedBrowser = vi.spyOn(client, "commandManagedBrowser").mockResolvedValue();
    vi.spyOn(client, "setManagedBrowserBounds").mockResolvedValue();
    const container = renderBrowser(client);
    const address = container.querySelector<HTMLInputElement>("input[aria-label='网址或搜索内容']");
    const browserSurface = container.querySelector("section > div:last-child");

    expect(browserSurface?.className).toContain("bg-[var(--app-canvas)]");

    address?.setSelectionRange(5, 5);
    act(() => address?.focus());

    expect(address?.selectionStart).toBe(0);
    expect(address?.selectionEnd).toBe(SESSION.url.length);

    const downloadsButton = container.querySelector<HTMLButtonElement>("button[aria-label='下载内容']");
    act(() => downloadsButton?.click());

    expect(commandManagedBrowser).toHaveBeenCalledWith({
      command: "showDownloads",
      sessionId: SESSION.sessionId,
      x: 0,
      y: 0,
    });
    expect(container.querySelector("[aria-label^='网页缩放']")).toBeNull();
  });

  it("opens a native workspace menu with the browser component's owned session", () => {
    const client = new MockAgentClient();
    const commandManagedBrowser = vi.spyOn(client, "commandManagedBrowser").mockResolvedValue();
    const setManagedBrowserBounds = vi.spyOn(client, "setManagedBrowserBounds").mockResolvedValue();

    renderBrowser(client, {
      canCreateSideChat: true,
      canOpenGitReview: true,
      canOpenTerminal: true,
      id: 1,
      kind: "add",
      x: 800,
      y: 72,
    });

    expect(commandManagedBrowser).toHaveBeenCalledWith({
      canCreateSideChat: true,
      canOpenGitReview: true,
      canOpenTerminal: true,
      command: "showWorkspaceAddMenu",
      sessionId: SESSION.sessionId,
      x: 800,
      y: 72,
    });
    expect(commandManagedBrowser).toHaveBeenCalledWith({
      colorScheme: "light",
      command: "setColorScheme",
      sessionId: SESSION.sessionId,
    });
    expect(setManagedBrowserBounds).toHaveBeenCalledWith(expect.objectContaining({ visible: true }));
    expect(setManagedBrowserBounds).not.toHaveBeenCalledWith(expect.objectContaining({ visible: false }));
  });
});
