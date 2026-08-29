import { describe, expect, it } from "vitest";

import { WorkspaceTerminalTabController } from "./workspace-terminal-tab-controller.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const SESSION = {
  projectId: PROJECT_ID,
  sessionId: "00000000-0000-4000-8000-000000000003",
  shellLabel: "PWSH（PowerShell 7）",
};

describe("WorkspaceTerminalTabController", () => {
  it("returns the exact Renderer-resolved tab name", async () => {
    const controller = new WorkspaceTerminalTabController();
    const dispose = controller.onOpenRequested((request) => {
      controller.confirmOpened({
        requestId: request.requestId,
        resolvedName: "构建日志 (1)",
      });
      return true;
    });

    await expect(controller.open({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      requestedName: "构建日志",
      signal: new AbortController().signal,
      session: SESSION,
    })).resolves.toEqual({
      requestedName: "构建日志",
      resolvedName: "构建日志 (1)",
    });
    dispose();
  });

  it("rejects immediately when no workspace listener can receive the request", async () => {
    const controller = new WorkspaceTerminalTabController();

    await expect(controller.open({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      requestedName: null,
      signal: new AbortController().signal,
      session: SESSION,
    })).rejects.toThrow("workspace window is unavailable");
  });
});
