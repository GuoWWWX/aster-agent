// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationToolItem } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { createProjectSession } from "../projects/project-session-model.js";
import { useProjectTree } from "../projects/use-project-tree.js";
import { RightSidebarWorkspace } from "./right-sidebar-workspace.js";

let root: Root | undefined;
const runId = "00000000-0000-4000-8000-000000000002";
const scroll = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  scroll.mockClear();
  useWorkbenchUiStore.setState({ activeActivity: "conversations", conversationReviewViewRequest: null, filePanelOpenByConversationId: {} });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens and reuses a review tab without a project and expands the requested merged file", async () => {
  const client = new MockAgentClient(); const conversation = await client.createConversation({ projectId: null });
  const target = createProjectSession(null, [], conversation.id);
  const tool = (path: string, id: string, targetRun = runId): ConversationToolItem => ({ id, runId: targetRun,
    kind: "tool", conversationId: target.id, createdAt: "2026-10-15T00:00:00Z", batchId: null,
    name: "write_file", status: "completed", arguments: "{}", result: "{}", diff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n` });
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([
    tool("src/a.ts", "tool-a"), tool("src/b.ts", "tool-b"), tool("src/b.ts", "tool-b2"), tool("old.ts", "tool-old", "other-run"),
  ]);
  function Harness() {
    const tree = useProjectTree(client);
    return <TooltipProvider><RightSidebarWorkspace activeProject={null} activeSession={target} agentClient={client} tree={tree}
      fileOpenRequest={null} teamMemberOpenRequest={null} onLocateProject={() => {}} onLocateSession={() => {}}
      onSessionUpdated={() => {}} onSessionViewed={() => {}} /></TooltipProvider>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  const open = async (path: string | null): Promise<void> => {
    await act(async () => { useWorkbenchUiStore.getState().openConversationReview({ conversationId: target.id, runId, path }); await Promise.resolve(); });
  };
  await open("src/b.ts");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(container.querySelector('[role="tab"]')?.textContent).toContain("审阅");
  expect(container.querySelectorAll("[data-review-file]")).toHaveLength(2);
  const file = container.querySelector('[data-review-file="src/b.ts"]')!;
  expect(file.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  expect(file.querySelector("button")?.textContent).toContain("+2-2");
  expect(file.textContent).toContain("第 2 次修改");
  expect(scroll).toHaveBeenCalled();
  act(() => file.querySelector("button")!.click());
  expect(file.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  await open("src/b.ts");
  expect(file.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  await open("src/a.ts");
  expect(container.querySelector('[data-review-file="src/a.ts"] button')?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(useWorkbenchUiStore.getState().filePanelOpenByConversationId[target.id]).toBe(true);
});
