// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ConversationRunEvent,
  ConversationSummary,
  TeamWorkItemExecutionView,
  UpdateTeamWorkItemInput,
} from "@agent/protocol";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAgentClient } from "../../runtime/mock-agent-client.js";
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

describe("TeamWorkspace", () => {
  it("keeps execution planning at the right side of the team tabs", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
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
    expect(container.querySelector("#workflow-canvas-heading")?.textContent).toBe("执行规划画布");
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
      root?.render(
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
      requirement: "让 Team Lead 委派一名开发成员。",
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
      root?.render(
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
});

class TeamWorkspaceEventClient extends MockAgentClient {
  public execution: TeamWorkItemExecutionView;

  public readonly executionRequests: string[] = [];

  private readonly listeners = new Set<(event: ConversationRunEvent) => void>();

  public constructor(execution: TeamWorkItemExecutionView) {
    super();
    this.execution = execution;
  }

  public override getTeamWorkItemExecution(workItemId: string): Promise<TeamWorkItemExecutionView> {
    this.executionRequests.push(workItemId);
    return Promise.resolve({ ...structuredClone(this.execution), workItemId });
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
