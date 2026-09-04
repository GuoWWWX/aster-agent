import { describe, expect, it, vi } from "vitest";

import { BrowserToolPlugin, BROWSER_TOOL_NAMES } from "./browser-tool-plugin.js";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const BROWSER_ID = "00000000-0000-4000-8000-000000000003";

describe("BrowserToolPlugin", () => {
  it("opens one visible browser tab and only allows its owner to observe and interact", async () => {
    const browser = {
      back: vi.fn(),
      capture: vi.fn().mockResolvedValue({ data: "aGVsbG8=", height: 600, mimeType: "image/jpeg", width: 800 }),
      close: vi.fn(),
      forward: vi.fn(),
      getSession: vi.fn().mockReturnValue({
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        sessionId: BROWSER_ID,
        title: "Example",
        url: "https://example.test/",
        zoomPercent: 100,
      }),
      interact: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      observe: vi.fn().mockResolvedValue({
        elements: [{
          bounds: { height: 30, width: 200, x: 10, y: 20 },
          id: "agent-1-0",
          name: "search",
          role: "input",
          tagName: "input",
          text: "Search",
        }],
        text: "Search the web",
        textTruncated: false,
        title: "Example",
        url: "https://example.test/",
        viewport: { height: 600, width: 800 },
      }),
      open: vi.fn().mockResolvedValue({
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        sessionId: BROWSER_ID,
        title: "Example",
        url: "https://example.test/",
        zoomPercent: 100,
      }),
      reload: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };
    const tabs = new WorkspaceBrowserTabController();
    tabs.onOpenRequested((request) => {
      tabs.confirmOpened({ requestId: request.requestId, resolvedName: "资料 (1)" });
      return true;
    });
    const plugin = new BrowserToolPlugin(browser, tabs);

    expect(plugin.getDefinitions().map((definition) => definition.name)).toEqual([
      BROWSER_TOOL_NAMES.control,
    ]);

    const openProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "open", name: "资料", url: "https://example.test" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(browser.open).not.toHaveBeenCalled();
    if (openProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    const opened = await openProposal.action.execute();
    expect(JSON.parse(opened.content)).toMatchObject({
      ok: true,
      value: { browserId: BROWSER_ID, resolvedName: "资料 (1)" },
    });

    const listed = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "list" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(JSON.parse(listed.content)).toMatchObject({
      ok: true,
      value: { sessions: [{ sessionId: BROWSER_ID, title: "Example" }] },
    });

    const observed = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "observe", browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(JSON.parse(observed.content)).toMatchObject({
      ok: true,
      value: { elements: [{ id: "agent-1-0" }], title: "Example" },
    });

    const screenshot = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "screenshot", browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(JSON.parse(screenshot.content)).toMatchObject({
      ok: true,
      value: { coordinateSpace: "screenshot_css_pixels", height: 600, width: 800 },
    });
    expect(screenshot.kind === "completed" ? screenshot.modelAttachments : undefined).toEqual([
      expect.objectContaining({ data: "aGVsbG8=", kind: "image", source: "browser" }),
    ]);

    const clickProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "click",
        browserId: BROWSER_ID,
        button: "right",
        x: 320,
        y: 240,
      }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    if (clickProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    await clickProposal.action.execute();
    expect(browser.interact).toHaveBeenCalledWith({
      button: "right",
      clickCount: 1,
      kind: "click",
      sessionId: BROWSER_ID,
      x: 320,
      y: 240,
    });
    browser.interact.mockClear();

    const fillProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "fill",
        browserId: BROWSER_ID,
        elementId: "agent-1-0",
        text: "agent tools",
      }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(browser.interact).not.toHaveBeenCalled();
    if (fillProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    const filled = await fillProposal.action.execute();
    expect(JSON.parse(filled.content)).toEqual({
      ok: true,
      value: { browserId: BROWSER_ID, performed: "fill" },
    });
    expect(browser.interact).toHaveBeenCalledWith({
      elementId: "agent-1-0",
      kind: "fill",
      sessionId: BROWSER_ID,
      text: "agent tools",
    });

    const closeRequested = vi.fn(() => true);
    tabs.onCloseRequested(closeRequested);
    const closeProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "close", browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(closeRequested).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    if (closeProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    const closed = await closeProposal.action.execute();
    expect(JSON.parse(closed.content)).toEqual({
      ok: true,
      value: { browserId: BROWSER_ID, closed: true },
    });
    expect(closeRequested).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, sessionId: BROWSER_ID });
    expect(browser.close).toHaveBeenCalledWith({ sessionId: BROWSER_ID });
  });

  it("keeps legacy browser names executable without advertising them", async () => {
    const browser = {
      back: vi.fn(),
      capture: vi.fn().mockResolvedValue({ data: "aGVsbG8=", height: 600, mimeType: "image/jpeg", width: 800 }),
      close: vi.fn(),
      forward: vi.fn(),
      getSession: vi.fn(),
      interact: vi.fn(),
      navigate: vi.fn(),
      observe: vi.fn().mockResolvedValue({
        elements: [],
        text: "Legacy",
        textTruncated: false,
        title: "Legacy",
        url: "https://example.test/",
        viewport: { height: 600, width: 800 },
      }),
      open: vi.fn(),
      reload: vi.fn(),
      stop: vi.fn(),
    };
    const plugin = new BrowserToolPlugin(browser, new WorkspaceBrowserTabController());

    expect(plugin.getDefinitions().map((definition) => definition.name)).not.toContain(BROWSER_TOOL_NAMES.observe);
    const result = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.observe,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("does not belong to this conversation");
  });
});
