// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ConversationRunEvent,
  ConversationSummary,
  ListTeamWorkItemsInput,
  PublishTeamWorkItemInput,
  TeamWorkItemExecutionView,
  TeamWorkItemView,
  UpdateTeamWorkItemInput,
} from "@agent/protocol";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { TeamWorkspace } from "./team-workspace.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function renderTeamWorkspace(workspace: ReactElement): void {
  root?.render(<TooltipProvider>{workspace}</TooltipProvider>);
}

describe("TeamWorkspace", () => {
  it("keeps execution planning at the right side of the team tabs", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => renderTeamWorkspace(
        <TeamWorkspace
          agentClient={new MockAgentClient()}
          onOpenConversation={() => undefined}
          projects={[{
          id: "00000000-0000-4000-8000-000000000001",
          name: "Mock Project",
          rootPath: "C:/mock-project",
        }]}
      />,
    ));

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.team-view-switcher [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "需求看板",
      "任务与验收",
      "执行规划",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".team-live-execution-panel")).toBeNull();
    expect(container.textContent).not.toContain("投递需求");

    act(() => tabs[2]?.click());
    expect(container.textContent).toContain("选择任务后查看真实协作计划与通信");
    expect(container.querySelector("#workflow-canvas-heading")).toBeNull();
  });

  it("edits a queued requirement in place instead of creating a second WorkItem", async () => {
    const client = new TeamWorkspaceEditClient();
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0];
    if (team === undefined) throw new Error("Default team fixture is unavailable.");
    const created = await client.submitTeamWorkItem({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "先投递的需求。",
      teamId: team.id,
      title: "先投递的需求",
    });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      renderTeamWorkspace(
        <TeamWorkspace
          agentClient={client}
          onOpenConversation={() => undefined}
          projects={[{
            id: "00000000-0000-4000-8000-000000000001",
            name: "Mock Project",
            rootPath: "C:/mock-project",
          }]}
        />,
      );
      await flushTeamWorkspace();
    });
    expect(container.querySelector('[aria-label="向团队发送需求"]')).toBeNull();

    const runtimeTab = [...container.querySelectorAll<HTMLButtonElement>(
      '.team-view-switcher [role="tab"]',
    )].find((tab) => tab.textContent === "任务与验收");
    await act(async () => {
      runtimeTab?.click();
      await flushTeamWorkspace();
    });
    const editButton = container.querySelector<HTMLButtonElement>(
      `[aria-label="编辑需求：${created.title}"]`,
    );
    expect(editButton).not.toBeNull();
    act(() => editButton?.click());

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="修改待执行需求"]',
    );
    expect(textarea?.value).toBe(created.requirement);
    act(() => {
      setNativeTextValue(textarea, "修改后的需求，仍然使用同一个任务。");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="保存需求"]')?.click();
      await flushTeamWorkspace();
    });

    expect(client.updateRequests).toEqual([{
      requirement: "修改后的需求，仍然使用同一个任务。",
      title: "修改后的需求，仍然使用同一个任务。",
      workItemId: created.id,
    }]);
    expect(await client.listTeamWorkItems({ teamId: team.id })).toEqual([
      expect.objectContaining({
        id: created.id,
        requirement: "修改后的需求，仍然使用同一个任务。",
        title: "修改后的需求，仍然使用同一个任务。",
      }),
    ]);
  });

  it("refreshes the roster when a newly delegated member reports its Conversation", async () => {
    const client = new TeamWorkspaceEventClient({
      agents: [],
      workItemId: "00000000-0000-4000-8000-000000000000",
    });
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0];
    if (team === undefined) throw new Error("Default team fixture is unavailable.");
    const workItem = await client.submitTeamWorkItem({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: `让 Team Lead 委派一名开发成员。${"请保持任务概要紧凑展示，并把长需求默认收起。".repeat(12)}`,
      teamId: team.id,
      title: "委派开发成员",
    });
    const lead = createTeamConversation({
      id: "00000000-0000-4000-8000-000000000101",
      teamWorkItemId: workItem.id,
      threadKind: "team_lead",
      title: "Team Lead · 委派开发成员",
    });
    const member = createTeamConversation({
      id: "00000000-0000-4000-8000-000000000102",
      parentConversationId: lead.id,
      teamWorkItemId: workItem.id,
      threadKind: "subagent",
      title: "Implementer · 实现功能",
    });
    client.execution = {
      agents: [{
        agent: {
          id: "team-lead",
          instructions: "负责委派。",
          isDefault: true,
          name: "Team Lead",
          role: "负责人",
        },
        conversation: lead,
        delegation: null,
        depth: 0,
      }],
      workItemId: workItem.id,
    };

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      renderTeamWorkspace(
        <TeamWorkspace
          agentClient={client}
          onOpenConversation={() => undefined}
          projects={[{
            id: "00000000-0000-4000-8000-000000000001",
            name: "Mock Project",
            rootPath: "C:/mock-project",
          }]}
        />,
      );
      await flushTeamWorkspace();
    });
    await act(async () => {
      await flushTeamWorkspace();
    });

    const runtimeTab = [...container.querySelectorAll<HTMLButtonElement>(
      '.team-view-switcher [role="tab"]',
    )].find((tab) => tab.textContent === "任务与验收");
    await act(async () => {
      runtimeTab?.click();
      await flushTeamWorkspace();
    });
    await act(async () => {
      await flushTeamWorkspace();
    });
    expect(container.querySelector('[aria-label="用户需求"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="协作与执行"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-team-runtime-card]')).toHaveLength(3);
    expect(container.querySelector('[data-team-runtime-card="requirement"]')?.textContent).toContain(workItem.requirement);
    expect(container.querySelector('[data-team-runtime-card="collaboration"]')).not.toBeNull();
    expect(container.querySelector('[data-team-runtime-card="progress"]')).not.toBeNull();
    expect(container.textContent).toContain("用户需求");
    expect(container.textContent).toContain("查看完整需求");
    expect(container.textContent).toContain("P2");
    expect(container.querySelector('[data-team-lead-avatar="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="用户需求"]')?.firstElementChild?.textContent).toContain("Team Lead 主对话");
    expect(container.querySelector('[aria-label="用户需求"]')?.firstElementChild?.textContent).toContain("查看完整需求");
    expect(container.querySelector('[aria-label="用户需求"]')?.firstElementChild?.textContent).toContain("打开对话");
    const runtimeTracks = "grid-rows-[145px_minmax(220px,280px)_minmax(320px,1fr)]";
    expect(container.querySelector('[data-team-runtime-layout="details"]')?.className).toContain(runtimeTracks);
    expect(container.querySelector('[data-team-runtime-layout="operations"]')?.className).toContain(runtimeTracks);
    expect(container.textContent).not.toContain("展开完整需求");
    expect(container.textContent).not.toContain("成员 Agent 位于该对话节点下方");
    expect(container.textContent).not.toContain("Implementer");
    expect(client.executionRequests).toContain(workItem.id);

    client.execution = {
      agents: [
        ...client.execution.agents,
        {
          agent: {
            id: "implementer",
            instructions: "实现功能。",
            isDefault: false,
            name: "Implementer",
            role: "开发",
          },
          conversation: member,
          delegation: {
            id: "00000000-0000-4000-8000-000000000103",
            status: "running",
            title: "实现功能",
          },
          depth: 1,
        },
      ],
      workItemId: workItem.id,
    };
    await act(async () => {
      client.emit({ conversation: member, type: "conversation.updated" });
      await flushTeamWorkspace();
    });
    await act(async () => {
      await flushTeamWorkspace();
    });

    expect(container.textContent).toContain("Implementer");
  });

  it("refreshes collaboration data again after a run finishes", async () => {
    const client = new TeamWorkspaceEventClient({
      agents: [],
      workItemId: "00000000-0000-4000-8000-000000000000",
    });
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0];
    if (team === undefined) throw new Error("Default team fixture is unavailable.");
    const workItem = await client.submitTeamWorkItem({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "验证成员回执刷新。",
      teamId: team.id,
      title: "验证成员回执刷新",
    });
    const lead = createTeamConversation({
      id: "00000000-0000-4000-8000-000000000111",
      teamWorkItemId: workItem.id,
      threadKind: "team_lead",
      title: "Team Lead · 验证成员回执刷新",
    });
    client.execution = {
      agents: [{ agent: null, conversation: lead, delegation: null, depth: 0 }],
      workItemId: workItem.id,
    };

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      renderTeamWorkspace(
        <TeamWorkspace
          agentClient={client}
          onOpenConversation={() => undefined}
          projects={[{
            id: "00000000-0000-4000-8000-000000000001",
            name: "Mock Project",
            rootPath: "C:/mock-project",
          }]}
        />,
      );
      await flushTeamWorkspace();
    });
    const requestCountBeforeFinish = client.projectionRequests.length;

    await act(async () => {
      client.emit({
        agentError: null,
        conversationId: lead.id,
        error: null,
        runId: "00000000-0000-4000-8000-000000000112",
        status: "completed",
        type: "run.finished",
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      await flushTeamWorkspace();
    });

    expect(client.projectionRequests.length).toBeGreaterThanOrEqual(requestCountBeforeFinish + 2);
  });

  it("publishes an unhandled blocked WorkItem from the collaboration card", async () => {
    const client = new TeamWorkspacePublishClient();
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0];
    if (team === undefined) throw new Error("Default team fixture is unavailable.");
    const workItem = await client.submitTeamWorkItem({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "重新发布未形成执行计划的任务。",
      teamId: team.id,
      title: "重新发布未处理任务",
    });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      renderTeamWorkspace(
        <TeamWorkspace
          agentClient={client}
          onOpenConversation={() => undefined}
          projects={[{
            id: "00000000-0000-4000-8000-000000000001",
            name: "Mock Project",
            rootPath: "C:/mock-project",
          }]}
        />,
      );
      await flushTeamWorkspace();
    });
    const runtimeTab = [...container.querySelectorAll<HTMLButtonElement>(
      '.team-view-switcher [role="tab"]',
    )].find((tab) => tab.textContent === "任务与验收");
    await act(async () => {
      runtimeTab?.click();
      await flushTeamWorkspace();
    });

    const publishButton = [...container.querySelectorAll<HTMLButtonElement>(
      '[data-team-runtime-card="collaboration"] button',
    )].find((button) => button.textContent?.includes("重新发布"));
    expect(publishButton).not.toBeNull();

    await act(async () => {
      publishButton?.click();
      await flushTeamWorkspace();
    });

    expect(client.publishRequests).toEqual([{ workItemId: workItem.id }]);
    expect([...container.querySelectorAll<HTMLButtonElement>(
      '[data-team-runtime-card="collaboration"] button',
    )].some((button) => button.textContent?.includes("重新发布"))).toBe(false);
  });
});

class TeamWorkspaceEventClient extends MockAgentClient {
  public execution: TeamWorkItemExecutionView;

  public readonly executionRequests: string[] = [];

  public readonly projectionRequests: string[] = [];

  private readonly listeners = new Set<(event: ConversationRunEvent) => void>();

  public constructor(execution: TeamWorkItemExecutionView) {
    super();
    this.execution = execution;
  }

  public override getTeamWorkItemExecution(workItemId: string): Promise<TeamWorkItemExecutionView> {
    this.executionRequests.push(workItemId);
    return Promise.resolve({ ...structuredClone(this.execution), workItemId });
  }

  public override getTeamCollaborationProjection(workItemId: string) {
    this.projectionRequests.push(workItemId);
    return super.getTeamCollaborationProjection(workItemId);
  }

  public override onConversationRunEvent(
    listener: (event: ConversationRunEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: ConversationRunEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

class TeamWorkspacePublishClient extends MockAgentClient {
  public readonly publishRequests: PublishTeamWorkItemInput[] = [];

  private isPublished = false;

  public override async listTeamWorkItems(
    input: ListTeamWorkItemsInput,
  ): Promise<TeamWorkItemView[]> {
    const items = await super.listTeamWorkItems(input);
    return items.map((item) => ({
      ...item,
      blockedReason: this.isPublished ? null : "应用退出后等待用户重新发布。",
      status: this.isPublished ? "running" : "blocked",
    }));
  }

  public override async publishTeamWorkItem(
    input: PublishTeamWorkItemInput,
  ): Promise<TeamWorkItemView> {
    this.publishRequests.push(input);
    this.isPublished = true;
    const [item] = await this.listTeamWorkItems({});
    if (item === undefined) throw new Error("Publish fixture WorkItem is unavailable.");
    return item;
  }
}

class TeamWorkspaceEditClient extends MockAgentClient {
  public readonly updateRequests: UpdateTeamWorkItemInput[] = [];

  public override updateTeamWorkItem(input: UpdateTeamWorkItemInput) {
    this.updateRequests.push(input);
    return super.updateTeamWorkItem(input);
  }
}

function createTeamConversation({
  id,
  parentConversationId = null,
  teamWorkItemId,
  threadKind,
  title,
}: {
  id: string;
  parentConversationId?: string | null;
  teamWorkItemId: string;
  threadKind: ConversationSummary["threadKind"];
  title: string;
}): ConversationSummary {
  const timestamp = "2026-08-29T00:00:00.000Z";
  return {
    activeSubagentCount: 0,
    activeRunId: "00000000-0000-4000-8000-000000000104",
    agentId: null,
    archivedAt: null,
    avatarIcon: null,
    createdAt: timestamp,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: "running",
    modelSelection: null,
    parentConversationId,
    pinOrder: null,
    projectId: "00000000-0000-4000-8000-000000000001",
    subagentTaskStatus: threadKind === "subagent" ? "running" : null,
    teamId: "default-team",
    teamWorkItemId,
    threadKind,
    title,
    updatedAt: timestamp,
    workspaceRootPath: "C:/mock-project",
  };
}

async function flushTeamWorkspace(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

function setNativeTextValue(
  element: HTMLTextAreaElement | null,
  value: string,
): void {
  if (element === null) throw new Error("Expected a Team WorkItem textarea.");
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  );
  if (descriptor === undefined) throw new Error("Textarea value setter is unavailable.");
  Reflect.set(HTMLTextAreaElement.prototype, "value", value, element);
}
