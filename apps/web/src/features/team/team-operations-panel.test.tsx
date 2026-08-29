// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationSummarySchema,
  type TeamWorkItemExecutionView,
} from "@agent/protocol";

import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import { TeamOperations } from "./team-operations-panel.js";

const WORK_ITEM_ID = "00000000-0000-4000-8000-000000000101";
const PROJECT_ID = "00000000-0000-4000-8000-000000000102";
const LEAD_CONVERSATION_ID = "00000000-0000-4000-8000-000000000103";
const MEMBER_CONVERSATION_ID = "00000000-0000-4000-8000-000000000104";

function conversation(id: string, title: string, threadKind: "team_lead" | "subagent") {
  return conversationSummarySchema.parse({
    activeRunId: null,
    createdAt: "2026-08-29T00:00:00.000Z",
    id,
    lastRunStatus: "completed",
    projectId: PROJECT_ID,
    teamId: "default-team",
    teamWorkItemId: WORK_ITEM_ID,
    threadKind,
    title,
    updatedAt: "2026-08-29T00:00:00.000Z",
  });
}

const item: TeamWorkItemPrototype = {
  acceptance: [],
  acceptedCriteria: [],
  acceptanceRound: 1,
  createdAt: "刚刚",
  delivery: null,
  events: [],
  finalizationAction: null,
  id: WORK_ITEM_ID,
  nextAction: "等待交付",
  plan: "开发后验证",
  priority: "normal",
  project: "Fixture",
  reworkRequest: null,
  source: "direct",
  status: "executing",
  tasks: [],
  title: "团队会话跳转",
};

const execution: TeamWorkItemExecutionView = {
  agents: [
    {
      agent: {
        id: "team-lead",
        instructions: "管理团队",
        isDefault: true,
        name: "Team Lead",
        role: "负责人",
      },
      conversation: conversation(LEAD_CONVERSATION_ID, "Team Lead · 团队会话跳转", "team_lead"),
      delegation: null,
      depth: 0,
    },
    {
      agent: {
        id: "developer",
        instructions: "实现功能",
        isDefault: false,
        name: "开发 Agent",
        role: "开发",
      },
      conversation: conversation(MEMBER_CONVERSATION_ID, "开发 Agent · 实现功能", "subagent"),
      delegation: {
        id: "00000000-0000-4000-8000-000000000105",
        status: "completed",
        title: "实现功能",
      },
      depth: 1,
    },
  ],
  workItemId: WORK_ITEM_ID,
};

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("TeamOperations", () => {
  it("opens the selected member in the normal conversation tree", () => {
    const onOpenConversation = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TeamOperations
        execution={execution}
        item={item}
        onOpenConversation={onOpenConversation}
      />,
    ));

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 开发 Agent 的对话"]')?.click();
    });

    expect(onOpenConversation).toHaveBeenCalledWith(execution.agents[1]?.conversation);
  });
});
