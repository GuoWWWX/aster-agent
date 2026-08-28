// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationToolItem } from "@agent/protocol";

import { MockAgentClient } from "../../runtime/index.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

const PARENT_ID = "00000000-0000-4000-8000-000000000001";
const CHILD_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const TOOL_ID = "00000000-0000-4000-8000-000000000004";

function session(input: Partial<ProjectSession> & Pick<ProjectSession, "id" | "title">): ProjectSession {
  return {
    activeRunId: null,
    agentId: null,
    hasUnreadResult: false,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    projectId: null,
    teamId: null,
    threadKind: "agent",
    workspaceRootPath: null,
    ...input,
  };
}

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Subagent approval queue", () => {
  it("shows a child's pending approval above the parent composer and submits it", async () => {
    const parent = session({ id: PARENT_ID, title: "主对话" });
    const child = session({
      activeRunId: RUN_ID,
      id: CHILD_ID,
      parentConversationId: PARENT_ID,
      threadKind: "subagent",
      title: "Ping GitHub",
    });
    const approval: ConversationToolItem = {
      arguments: '{"command":"ping -n 4 github.com"}',
      batchId: null,
      conversationId: CHILD_ID,
      createdAt: "2026-08-28T00:00:00.000Z",
      diff: null,
      id: TOOL_ID,
      kind: "tool",
      name: "run_command",
      result: null,
      runId: RUN_ID,
      status: "awaiting_approval",
    };
    const client = new MockAgentClient();
    vi.spyOn(client, "listConversationTimeline").mockImplementation(({ conversationId }) =>
      Promise.resolve(conversationId === CHILD_ID ? [approval] : [])
    );
    const approve = vi.spyOn(client, "approveToolChange").mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationWorkspace
          agentClient={client}
          project={null}
          relatedSessions={[parent, child]}
          session={parent}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Subagent 等待审批");
    expect(container.textContent).toContain("Ping GitHub");
    expect(container.textContent).toContain("运行 ping -n 4 github.com");

    const allowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("仅本次允许") === true,
    );
    await act(async () => {
      allowButton?.click();
      await Promise.resolve();
    });

    expect(approve).toHaveBeenCalledWith({
      approved: true,
      runId: RUN_ID,
      scope: "once",
      toolId: TOOL_ID,
    });
  });
});
