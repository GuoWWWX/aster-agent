// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedBrowserSession } from "@agent/protocol";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
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
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: TestResizeObserver,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function renderBrowser(
  client: MockAgentClient,
  menuRequest: ManagedBrowserWorkspaceMenuRequest | null = null,
): HTMLDivElement {
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
