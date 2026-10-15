// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent, type ConversationTaskList } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

const popover = vi.hoisted(() => ({ change: undefined as ((open: boolean) => void) | undefined }));
vi.mock("../../components/ui/popover.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/ui/popover.js")>();
  return { ...actual, Popover: (props: ComponentProps<typeof actual.Popover>) => {
    popover.change = props.onOpenChange;
    return <actual.Popover {...props} />;
  } };
});

const conversationId = "00000000-0000-4000-8000-000000000001";
const session: ProjectSession = { id: conversationId, title: "任务列表", activeRunId: null, agentId: null,
  hasUnreadResult: false, isArchived: false, isPinned: false, lastRunStatus: null, modelSelection: null,
  parentConversationId: null, projectId: null, teamId: null, threadKind: "agent", workspaceRootPath: null };
const taskList: ConversationTaskList = { conversationId, status: "active", closedAt: null,
  createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z",
  tasks: [{ id: "task-1", title: "检查页面与交互", status: "running", reason: null }] };
let root: Root;
let container: HTMLDivElement;
let emit: (event: ConversationRunEvent) => void;
const readHistory = vi.fn(() => "已完成此前的检查。");

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const client = new MockAgentClient();
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { emit = listener; return () => {}; });
  vi.spyOn(client, "getConversationTaskList").mockResolvedValue(taskList);
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000002",
    kind: "message", conversationId, runId: null, createdAt: "2026-10-16T00:00:00Z", role: "assistant",
    get content() { return readHistory(); }, modelId: null, attachments: [], status: "completed" }]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => {
    root.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={session} /></TooltipProvider>);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  readHistory.mockClear();
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const summary = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>(".conversation-task-list__summary")!;

it("opens and closes task details without reprocessing the conversation history", () => {
  act(() => summary().click());
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector(".conversation-task-list__details")?.textContent).toContain("检查页面与交互");
  expect(readHistory).not.toHaveBeenCalled();
  act(() => summary().click());
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  expect(readHistory).not.toHaveBeenCalled();
});

it("treats repeated dismiss notifications as closing rather than toggling back open", () => {
  act(() => summary().click());
  act(() => { popover.change?.(false); popover.change?.(false); });
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".conversation-task-list__details")).toBeNull();
  act(() => summary().click());
  expect(summary().getAttribute("aria-expanded")).toBe("true");
});

it("preserves expansion across task updates and resets after the task list is removed", () => {
  act(() => summary().click());
  act(() => emit({ type: "task_list.updated", conversationId, runId: "00000000-0000-4000-8000-000000000003", taskList: { ...taskList,
    tasks: [{ ...taskList.tasks[0]!, title: "交付检查结果", status: "completed" }] } }));
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector(".conversation-task-list__details")?.textContent).toContain("交付检查结果");
  act(() => emit({ type: "task_list.updated", conversationId, runId: "00000000-0000-4000-8000-000000000003", taskList: null }));
  expect(container.querySelector(".conversation-task-list")).toBeNull();
  act(() => emit({ type: "task_list.updated", conversationId, runId: "00000000-0000-4000-8000-000000000003", taskList }));
  expect(summary().getAttribute("aria-expanded")).toBe("false");
});
