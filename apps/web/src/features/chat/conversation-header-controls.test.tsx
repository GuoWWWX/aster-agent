// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationTimelineItem, ProjectSummary } from "@agent/protocol";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationHeaderControls } from "./conversation-header-controls.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const PARENT_ID = "00000000-0000-4000-8000-000000000002";
const ACTIVE_CHILD_ID = "00000000-0000-4000-8000-000000000003";
const COMPLETE_CHILD_ID = "00000000-0000-4000-8000-000000000004";
const FAILED_CHILD_ID = "00000000-0000-4000-8000-000000000005";
const CLOSED_CHILD_ID = "00000000-0000-4000-8000-000000000006";
const RECOVERED_CHILD_ID = "00000000-0000-4000-8000-000000000007";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConversationHeaderControls", () => {
  it("uses existing Subagent avatars and separates running, completed, and ended work", async () => {
    const client = new MockAgentClient();
    enableGit(client);
    vi.spyOn(client, "listConversationTimeline").mockImplementation(({ conversationId }) =>
      Promise.resolve(conversationId === COMPLETE_CHILD_ID
        ? [assistantMessage(COMPLETE_CHILD_ID, "已完成登录页视觉核对。")]
        : []));
    const onOpenSubagent = vi.fn();
    const onDeleteSubagent = vi.fn().mockResolvedValue(undefined);
    const container = renderControls(
      client,
      [
        subagent(ACTIVE_CHILD_ID, "视觉核对", "running"),
        subagent(COMPLETE_CHILD_ID, "测试补充", "completed"),
        subagent(FAILED_CHILD_ID, "构建检查", "failed"),
        subagent(CLOSED_CHILD_ID, "已结束任务", "ended"),
        {
          ...subagent(RECOVERED_CHILD_ID, "返工成功", "failed"),
          lastRunStatus: "completed",
        },
      ],
      onOpenSubagent,
      vi.fn(),
      onDeleteSubagent,
    );

    const activeStrip = container.querySelector<HTMLElement>('[aria-label="1 个活跃子代理"]');
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="查看全部子代理"]');
    expect(activeStrip).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(activeStrip?.querySelectorAll(".agent-profile-avatar")).toHaveLength(1);
    expect(trigger?.querySelector(".agent-profile-avatar")).toBeNull();
    act(() => activeStrip?.querySelector<HTMLButtonElement>(
      '[aria-label="打开活跃子代理 视觉核对"]',
    )?.click());
    expect(onOpenSubagent).toHaveBeenCalledWith(expect.objectContaining({ id: ACTIVE_CHILD_ID }));

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(trigger?.dataset.open).toBe("true");
    expect(document.body.textContent).toContain("正在运行");
    expect(document.body.textContent).toContain("完成工作");
    expect(document.body.textContent).toContain("已结束");
    expect(document.body.textContent).toContain("已完成登录页视觉核对。");
    expect(document.body.querySelector('[data-subagent-status="working"]')).not.toBeNull();
    expect(document.body.querySelector('[data-subagent-status="completed"]')).not.toBeNull();
    expect(document.body.querySelector('[data-subagent-status="failed"]')).not.toBeNull();
    expect(document.body.querySelector('[data-subagent-status="ended"]')).not.toBeNull();
    expect(document.body.querySelector(
      `[data-subagent-id="${RECOVERED_CHILD_ID}"] [data-subagent-status="completed"]`,
    )).not.toBeNull();
    expect(document.body.querySelector(`[data-subagent-id="${CLOSED_CHILD_ID}"]`)).not.toBeNull();
    const completedRow = document.body.querySelector<HTMLElement>(
      `[data-subagent-id="${COMPLETE_CHILD_ID}"]`,
    );
    await act(async () => {
      completedRow?.querySelector<HTMLButtonElement>('[aria-label="删除子代理 测试补充"]')?.click();
      await Promise.resolve();
    });
    expect(onDeleteSubagent).toHaveBeenCalledWith(expect.objectContaining({ id: COMPLETE_CHILD_ID }));
    act(() => completedRow?.querySelector<HTMLButtonElement>('[aria-label="打开子代理对话 测试补充"]')?.click());
    expect(onOpenSubagent).toHaveBeenCalledWith(expect.objectContaining({ id: COMPLETE_CHILD_ID }));
    expect(completedRow?.querySelector('[data-lucide="arrow-up-right"]')).toBeNull();
  });

  it("shows branch and change totals and opens the Git workspace", async () => {
    const client = new MockAgentClient();
    enableGit(client);
    vi.spyOn(client, "getGitReviewSnapshot").mockResolvedValue({
      ahead: 0,
      behind: 0,
      branch: "feature/header-controls",
      branches: [],
      changes: [
        { additions: 12, deletions: 3, isStaged: false, originalPath: null, path: "apps/web/src/app.tsx", status: " M" },
        { additions: 5, deletions: 1, isStaged: true, originalPath: null, path: "doc/14-业务上下文.md", status: "M " },
      ],
      isRepository: true,
      projectId: PROJECT_ID,
      refreshedAt: "2026-09-04T00:00:00.000Z",
      upstream: null,
    });
    const onOpenGitReview = vi.fn();
    const container = renderControls(client, [], vi.fn(), onOpenGitReview);

    const inactiveStrip = container.querySelector<HTMLElement>('[aria-label="0 个活跃子代理"]');
    expect(inactiveStrip).not.toBeNull();
    expect(inactiveStrip?.textContent).toContain("0");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="查看 Git 变更"]');
    expect(trigger?.textContent).toContain("feature/header-controls");
    expect(trigger?.textContent).toContain("+17");
    expect(trigger?.textContent).toContain("−4");

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });
    expect(trigger?.dataset.open).toBe("true");
    expect(document.body.textContent).toContain("apps/web/src/app.tsx");
    const fileButton = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="查看 apps/web/src/app.tsx 的文件差异"]',
    );
    act(() => fileButton?.click());
    expect(onOpenGitReview).toHaveBeenCalledWith("apps/web/src/app.tsx");
    expect(trigger?.dataset.open).toBe("false");
  });

  it("loads subagent previews with bounded concurrency", async () => {
    const client = new MockAgentClient();
    enableGit(client);
    const pendingResolvers: Array<() => void> = [];
    const timelineSpy = vi.spyOn(client, "listConversationTimeline").mockImplementation(
      ({ conversationId }) => new Promise((resolve) => {
        pendingResolvers.push(() => resolve([
          assistantMessage(conversationId, `输出 ${conversationId}`),
        ]));
      }),
    );
    const subagentIds = [
      "00000000-0000-4000-8000-000000000021",
      "00000000-0000-4000-8000-000000000022",
      "00000000-0000-4000-8000-000000000023",
      "00000000-0000-4000-8000-000000000024",
    ];
    const container = renderControls(
      client,
      subagentIds.map((id, index) => subagent(id, `子代理 ${index + 1}`, "completed")),
      vi.fn(),
    );

    const inactiveStrip = container.querySelector<HTMLElement>('[aria-label="0 个活跃子代理"]');
    expect(inactiveStrip).not.toBeNull();
    expect(inactiveStrip?.textContent).toContain("0");
    expect(inactiveStrip?.querySelector(".conversation-header-subagents__placeholder")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="查看全部子代理"]')?.click();
      await Promise.resolve();
    });
    expect(timelineSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingResolvers[0]?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(timelineSpy).toHaveBeenCalledTimes(3);
  });
});

function renderControls(
  client: MockAgentClient,
  subagents: ProjectSession[],
  onOpenSubagent: (subagent: ProjectSession) => void,
  onOpenGitReview: (path?: string) => void = vi.fn(),
  onDeleteSubagent: (subagent: ProjectSession) => Promise<void> = vi.fn().mockResolvedValue(undefined),
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const project: ProjectSummary = {
    id: PROJECT_ID,
    isPinned: false,
    name: "Agent",
    rootPath: "D:\\Code\\Agent",
  };
  act(() => root?.render(
    <TooltipProvider>
      <ConversationHeaderControls
        agentClient={client}
        project={project}
        subagents={subagents}
        onDeleteSubagent={onDeleteSubagent}
        onOpenGitReview={onOpenGitReview}
        onOpenSubagent={onOpenSubagent}
      />
    </TooltipProvider>,
  ));
  return container;
}

function subagent(
  id: string,
  title: string,
  status: "completed" | "ended" | "failed" | "running",
): ProjectSession {
  return {
    activeRunId: status === "running" ? "00000000-0000-4000-8000-000000000010" : null,
    agentId: null,
    avatarIcon: null,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: status === "running" || status === "ended" ? null : status,
    modelSelection: null,
    parentConversationId: PARENT_ID,
    projectId: PROJECT_ID,
    subagentTaskStatus: status,
    teamId: null,
    threadKind: "subagent",
    title,
    workspaceRootPath: null,
  };
}

function assistantMessage(conversationId: string, content: string): ConversationTimelineItem {
  return {
    attachments: [],
    content,
    conversationId,
    createdAt: "2026-09-04T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000011",
    kind: "message",
    modelId: "gpt-5.6-terra",
    role: "assistant",
    runId: "00000000-0000-4000-8000-000000000012",
    status: "completed",
  };
}

function enableGit(client: MockAgentClient): void {
  vi.spyOn(client, "getCapabilities").mockResolvedValue({
    docxConversion: false,
    fileWrite: true,
    git: true,
    managedBrowser: false,
    mcp: false,
    mode: "desktop",
    process: true,
    pty: true,
    skills: true,
    workspace: true,
  });
}
