import { describe, expect, it, vi } from "vitest";

import { BrowserToolPlugin, BROWSER_TOOL_NAMES } from "./browser-tool-plugin.js";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const BROWSER_ID = "00000000-0000-4000-8000-000000000003";

describe("BrowserToolPlugin", () => {
  it("opens one visible browser tab and only allows its owner to observe and interact", async () => {
    const browser = {
      close: vi.fn(),
      interact: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      observe: vi.fn().mockResolvedValue({
        elements: [{ id: "agent-1-0", name: "search", role: "input", tagName: "input", text: "Search" }],
        text: "Search the web",
        textTruncated: false,
        title: "Example",
        url: "https://example.test/",
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
    };
    const tabs = new WorkspaceBrowserTabController();
    tabs.onOpenRequested((request) => {
      tabs.confirmOpened({ requestId: request.requestId, resolvedName: "资料 (1)" });
      return true;
    });
    const plugin = new BrowserToolPlugin(browser, tabs);

    expect(plugin.getDefinitions().map((definition) => definition.name)).toEqual([
      BROWSER_TOOL_NAMES.open,
      BROWSER_TOOL_NAMES.observe,
      BROWSER_TOOL_NAMES.navigate,
      BROWSER_TOOL_NAMES.click,
      BROWSER_TOOL_NAMES.fill,
      BROWSER_TOOL_NAMES.select,
      BROWSER_TOOL_NAMES.key,
      BROWSER_TOOL_NAMES.scroll,
      BROWSER_TOOL_NAMES.wait,
      BROWSER_TOOL_NAMES.close,
    ]);

    const openProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ name: "资料", url: "https://example.test" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.open,
    });
    expect(browser.open).not.toHaveBeenCalled();
    if (openProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    const opened = await openProposal.action.execute();
    expect(JSON.parse(opened.content)).toMatchObject({
      ok: true,
      value: { browserId: BROWSER_ID, resolvedName: "资料 (1)" },
    });

    const observed = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.observe,
    });
    expect(JSON.parse(observed.content)).toMatchObject({
      ok: true,
      value: { elements: [{ id: "agent-1-0" }], title: "Example" },
    });

    const fillProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ browserId: BROWSER_ID, elementId: "agent-1-0", text: "agent tools" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.fill,
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
      rawArguments: JSON.stringify({ browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.close,
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
});
