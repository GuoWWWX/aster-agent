import { describe, expect, it, vi } from "vitest";

import { BrowserToolPlugin, BROWSER_TOOL_NAMES } from "./browser-tool-plugin.js";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const BROWSER_ID = "00000000-0000-4000-8000-000000000003";

describe("BrowserToolPlugin", () => {
  it.each(["selected", "except", "all"] as const)("discovers manual tabs and closes %s tabs only after approval", async (mode) => {
    const ids = [BROWSER_ID, "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
    const session = (id: string) => ({ sessionId: id, title: id, url: "https://example.test/", zoomPercent: 100, isLoading: false, canGoBack: false, canGoForward: false });
    const alive = new Set(ids);
    const browser = { back: vi.fn(), capture: vi.fn().mockResolvedValue({ data: "aGVsbG8=", height: 600, width: 800, mimeType: "image/jpeg" }), close: vi.fn(({ sessionId }: { sessionId: string }) => { alive.delete(sessionId); }),
      forward: vi.fn(), getSession: vi.fn(({ sessionId }: { sessionId: string }) => session(sessionId)), interact: vi.fn(), navigate: vi.fn(),
      observe: vi.fn().mockResolvedValue({ text: "Current page", title: "Example", elements: [] }), open: vi.fn(), reload: vi.fn(), stop: vi.fn(),
      listForConversation: vi.fn((id: string) => id === CONVERSATION_ID ? [...alive].map(session) : []),
    };
    const tabs = new WorkspaceBrowserTabController(); const closed = vi.fn(() => true); tabs.onCloseRequested(closed);
    const plugin = new BrowserToolPlugin(browser, tabs);
    const execute = (arguments_: unknown) => plugin.execute({ conversationId: CONVERSATION_ID, projectId: PROJECT_ID,
      rawArguments: JSON.stringify(arguments_), signal: new AbortController().signal, toolName: "browser_control" });
    const list = await execute({ action: "list" });
    expect(JSON.parse(list.content)).toMatchObject({ value: { sessions: ids.map(browserId => ({ browserId })) } });
    await execute({ action: "observe", browserId: ids[1] });
    expect(browser.observe).toHaveBeenCalledWith({ sessionId: ids[1] });
    const shown = vi.fn((request: { requestId: string }) => {
      tabs.confirmOpened({ requestId: request.requestId, resolvedName: "Existing page" });
      return true;
    });
    tabs.onOpenRequested(shown);
    const show = await execute({ action: "show", browserId: ids[1] });
    expect(shown).not.toHaveBeenCalled();
    if (show.kind !== "approved_action") throw new Error("Expected approval");
    expect(JSON.parse((await show.action.execute()).content)).toMatchObject({ value: { browserId: ids[1], shown: true } });
    expect(shown).toHaveBeenCalledOnce();
    expect((await execute({ action: "show", browserId: PROJECT_ID })).isError).toBe(true);
    const rejected = await execute({ action: "close_tabs", browserIds: [PROJECT_ID] });
    expect(rejected.isError).toBe(true);
    const invalid = await execute({ action: "close_tabs", browserIds: ids, exceptBrowserIds: [] });
    expect(invalid.isError).toBe(true);
    const proposal = await execute({ action: "close_tabs", ...(mode === "selected" ? { browserIds: [ids[1]] }
      : mode === "except" ? { exceptBrowserIds: [ids[1]] } : {}) });
    expect(browser.close).not.toHaveBeenCalled();
    if (proposal.kind !== "approved_action") throw new Error("Expected approval");
    const result = await proposal.action.execute();
    const expected = mode === "selected" ? [ids[1]] : mode === "except" ? [ids[0], ids[2]] : ids;
    expect(JSON.parse(result.content)).toMatchObject({ value: { closedBrowserIds: expected } });
    expect(closed).toHaveBeenCalledTimes(expected.length);
    expect(browser.close.mock.calls.map(([input]) => input.sessionId)).toEqual(expected);
    tabs.dispose();
  });
  it.each([false, true].flatMap(background => [PROJECT_ID, CONVERSATION_ID].map(projectId => ({ background, projectId }))))("opens and controls an owned browser in $projectId with background=$background", async ({ background, projectId }) => {
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
    const tabRequested = vi.fn((request: { requestId: string }) => {
      tabs.confirmOpened({ requestId: request.requestId, resolvedName: "资料 (1)" });
      return true;
    });
    tabs.onOpenRequested(tabRequested);
    const plugin = new BrowserToolPlugin(browser, tabs);

    expect(plugin.getDefinitions().map((definition) => definition.name)).toEqual([
      BROWSER_TOOL_NAMES.control,
    ]);

    const openProposal = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId,
      rawArguments: JSON.stringify({ action: "open", background, name: "资料", url: "https://example.test" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(browser.open).not.toHaveBeenCalled();
    if (openProposal.kind !== "approved_action") throw new Error("Expected browser approval proposal.");
    const opened = await openProposal.action.execute();
    expect(JSON.parse(opened.content)).toMatchObject({
      ok: true,
      value: { browserId: BROWSER_ID, background, resolvedName: background ? "资料" : "资料 (1)" },
    });
    expect(tabRequested).toHaveBeenCalledTimes(1);
    expect(browser.open).toHaveBeenCalledWith({ url: "https://example.test" }, background
      ? expect.objectContaining({ background: { width: 1280, height: 800 } }) : undefined);

    const listed = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId,
      rawArguments: JSON.stringify({ action: "list" }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(JSON.parse(listed.content)).toMatchObject({
      ok: true,
      value: { sessions: [{ sessionId: BROWSER_ID, title: "Example" }] },
    });

    const directScreenshot = await plugin.execute({
      conversationId: CONVERSATION_ID, projectId,
      rawArguments: JSON.stringify({ action: "screenshot", browserId: BROWSER_ID }),
      signal: new AbortController().signal, toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(directScreenshot.isError).toBe(false);
    expect(browser.observe).not.toHaveBeenCalled();
    expect(browser.capture).toHaveBeenCalledOnce();

    const observed = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId,
      rawArguments: JSON.stringify({ action: "observe", browserId: BROWSER_ID }),
      signal: new AbortController().signal,
      toolName: BROWSER_TOOL_NAMES.control,
    });
    expect(JSON.parse(observed.content)).toMatchObject({
      ok: true,
      value: { elements: [{ id: "agent-1-0" }], title: "Example", coordinateSpace: "screenshot_css_pixels", width: 800, height: 600 },
    });
    expect(observed.kind === "completed" ? observed.modelAttachments : undefined).toEqual([
      expect.objectContaining({ data: "aGVsbG8=", kind: "image", source: "browser" }),
    ]);
    expect(browser.capture).toHaveBeenCalledTimes(2);

    const screenshot = await plugin.execute({
      conversationId: CONVERSATION_ID,
      projectId,
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
      projectId,
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
      projectId,
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
      projectId,
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
    expect(closeRequested).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledWith({ sessionId: BROWSER_ID });
    if (background) {
      const reopened = await plugin.execute({ conversationId: CONVERSATION_ID, projectId: PROJECT_ID,
        rawArguments: JSON.stringify({ action: "open", background: true, width: 620, height: 900, url: "https://example.test" }),
        signal: new AbortController().signal, toolName: BROWSER_TOOL_NAMES.control });
      if (reopened.kind !== "approved_action") throw new Error("Expected background approval.");
      await reopened.action.execute();
      plugin.closeBackground(PROJECT_ID);
      expect(browser.close).toHaveBeenCalledTimes(1);
      plugin.closeBackground(CONVERSATION_ID);
      expect(browser.close).toHaveBeenCalledTimes(2);
      plugin.closeBackground(CONVERSATION_ID);
      expect(browser.close).toHaveBeenCalledTimes(2);
    }
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
