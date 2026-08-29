import { describe, expect, it, vi } from "vitest";

import { WorkspaceBrowserTabController } from "./workspace-browser-tab-controller.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const SESSION = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  sessionId: "00000000-0000-4000-8000-000000000003",
  title: "Example",
  url: "https://example.test/",
  zoomPercent: 100,
};

describe("WorkspaceBrowserTabController", () => {
  it("returns the exact Renderer-resolved browser tab name", async () => {
    const controller = new WorkspaceBrowserTabController();
    controller.onOpenRequested((request) => {
      controller.confirmOpened({ requestId: request.requestId, resolvedName: "网页 (1)" });
      return true;
    });

    await expect(controller.open({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      requestedName: "网页",
      session: SESSION,
      signal: new AbortController().signal,
    })).resolves.toEqual({ requestedName: "网页", resolvedName: "网页 (1)" });
  });

  it("notifies the Renderer when an AI tool closes its browser tab", () => {
    const controller = new WorkspaceBrowserTabController();
    const closeRequested = vi.fn(() => true);
    controller.onCloseRequested(closeRequested);

    controller.close({ conversationId: CONVERSATION_ID, sessionId: SESSION.sessionId });

    expect(closeRequested).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      sessionId: SESSION.sessionId,
    });
  });
});
