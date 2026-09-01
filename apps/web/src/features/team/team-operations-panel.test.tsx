// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationSummarySchema,
  type TeamWorkItemExecutionView,
} from "@agent/protocol";

import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import {
  TeamOperations,
  type TeamConversationActivity,
} from "./team-operations-panel.js";

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
  events: [{
    actor: "开发 Agent",
    detail: "完成实现并提交回执。",
    id: "event-1",
    time: "刚刚",
    type: "completion",
  }],
  finalizationAction: null,
  id: WORK_ITEM_ID,
  nextAction: "等待交付",
  plan: "开发后验证",
  priority: "normal",
  project: "Fixture",
  projectId: "00000000-0000-4000-8000-000000000001",
  reworkRequest: null,
  source: "direct",
  status: "executing",
  tasks: [],
  title: "团队会话跳转",
  updatedAt: "刚刚",
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

const activities: TeamConversationActivity[] = [{
  actor: "开发 Agent",
  actorConversationId: MEMBER_CONVERSATION_ID,
  content: "完成实现并提交回执。",
  conversation: execution.agents[1]?.conversation ?? conversation(
    MEMBER_CONVERSATION_ID,
    "开发 Agent · 实现功能",
    "subagent",
  ),
  createdAt: "2026-08-29T00:01:00.000Z",
  id: `${MEMBER_CONVERSATION_ID}:message-1`,
  time: "刚刚",
  timelineItemId: "message-1",
}];

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
  it("uses the task conversation trajectory instead of a comment composer", () => {
    const onOpenConversation = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TeamOperations
        activities={activities}
        execution={execution}
        item={{ ...item, status: "completed" }}
        onOpenConversation={onOpenConversation}
      />,
    ));

    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[aria-label="在对话中定位 开发 Agent 的这条消息"]',
      )?.click();
    });

    expect(container.textContent).toContain("任务对话轨迹");
    expect(container.textContent).toContain("完成实现并提交回执。");
    expect(container.querySelector('[aria-label="添加任务评论"]')).toBeNull();
    expect(onOpenConversation).toHaveBeenCalledWith(
      execution.agents[1]?.conversation,
      "message-1",
    );
  });

  it("opens the selected member in the normal conversation tree", () => {
    const onOpenConversation = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TeamOperations
        activities={activities}
        execution={execution}
        item={item}
        onOpenConversation={onOpenConversation}
      />,
    ));

    expect(container.textContent).toContain("执行概况");
    expect(container.querySelector('[aria-label="执行汇总"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-team-operations-card]')).toHaveLength(3);
    expect(container.querySelector('[data-team-runtime-layout="operations"]')?.className).toContain(
      "grid-rows-[145px_minmax(220px,280px)_minmax(320px,1fr)]",
    );
    expect(container.querySelectorAll(".agent-profile-avatar")).toHaveLength(3);
    expect(container.querySelector(`[data-activity-member-avatar="${MEMBER_CONVERSATION_ID}"]`)).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 开发 Agent 的对话"]')?.click();
    });

    expect(onOpenConversation).toHaveBeenCalledWith(execution.agents[1]?.conversation);
  });

  it("uses work state instead of task result as the member status", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TeamOperations
        activities={activities}
        execution={execution}
        item={item}
        onOpenConversation={vi.fn()}
      />,
    ));

    expect(container.querySelectorAll('[data-member-work-state="idle"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-member-work-state="working"]')).toHaveLength(0);
    expect(container.textContent).toContain("空闲");
    expect(container.textContent).not.toContain("待命");
    expect(container.textContent).not.toContain("执行失败");

    const developer = execution.agents[1];
    expect(developer).toBeDefined();
    if (developer === undefined) return;

    act(() => root?.render(
      <TeamOperations
        activities={activities}
        execution={{
          ...execution,
          agents: execution.agents.map((member) => member.conversation.id === developer.conversation.id
            ? {
              ...developer,
              conversation: {
                ...developer.conversation,
                activeRunId: "00000000-0000-4000-8000-000000000106",
                lastRunStatus: "running",
              },
              delegation: developer.delegation === null
                ? null
                : { ...developer.delegation, status: "running" },
            }
            : member),
        }}
        item={item}
        onOpenConversation={vi.fn()}
      />,
    ));

    expect(container.querySelectorAll('[data-member-work-state="idle"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-member-work-state="working"]')).toHaveLength(1);
    expect(container.textContent).toContain("工作中");
    expect(container.textContent).toContain("1 运行中");
  });
});
