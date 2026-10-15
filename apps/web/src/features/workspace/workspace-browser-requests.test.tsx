// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceBrowserTabOpenRequest, WorkspaceBrowserTabCloseRequest } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient, type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { createProjectSession } from "../projects/project-session-model.js";
import { useProjectTree } from "../projects/use-project-tree.js";
import { RightSidebarWorkspace } from "./right-sidebar-workspace.js";

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useWorkbenchUiStore.setState({ activeActivity: "conversations", filePanelOpenByConversationId: {} });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("acknowledges and closes a browser requested by the active projectless conversation", async () => {
  const client = new MockAgentClient();
  const capabilities = await client.getCapabilities();
  vi.spyOn(client, "getCapabilities").mockResolvedValue({ ...capabilities, managedBrowser: true });
  const conversation = await client.createConversation({ projectId: null });
  const target = createProjectSession(null, [], conversation.id);
  let open!: (request: WorkspaceBrowserTabOpenRequest) => void;
  let close!: (request: WorkspaceBrowserTabCloseRequest) => void;
  const port: AgentClient = client;
  vi.spyOn(port, "onWorkspaceBrowserTabOpenRequested").mockImplementation(listener => { open = listener; return () => {}; });
  vi.spyOn(port, "onWorkspaceBrowserTabCloseRequested").mockImplementation(listener => { close = listener; return () => {}; });
  const confirm = vi.spyOn(client, "confirmWorkspaceBrowserTabOpened");
  function Harness() {
    const tree = useProjectTree(client);
    return <TooltipProvider><RightSidebarWorkspace activeProject={null} activeSession={target} agentClient={client} tree={tree}
      fileOpenRequest={null} teamMemberOpenRequest={null} onLocateProject={() => {}} onLocateSession={() => {}}
      onSessionUpdated={() => {}} onSessionViewed={() => {}} /></TooltipProvider>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  const request: WorkspaceBrowserTabOpenRequest = {
    conversationId: target.id, projectId: target.id, requestedName: "页面验收",
    requestId: "00000000-0000-4000-8000-000000000002",
    session: { sessionId: "00000000-0000-4000-8000-000000000003", title: "页面", url: "http://127.0.0.1:8765/", isLoading: false, canGoBack: false, canGoForward: false, zoomPercent: 100 },
  };
  await act(async () => { open({ ...request, projectId: "00000000-0000-4000-8000-000000000004" }); await Promise.resolve(); });
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => { open({ ...request, conversationId: "00000000-0000-4000-8000-000000000004" }); await Promise.resolve(); });
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => { open(request); await Promise.resolve(); });
  expect(confirm).toHaveBeenCalledWith({ requestId: request.requestId, resolvedName: "页面验收" });
  expect(container.querySelector('[role="tab"]')?.textContent).toContain("页面验收");
  expect(useWorkbenchUiStore.getState().filePanelOpenByConversationId[target.id]).toBe(true);
  await act(async () => { close({ conversationId: target.id, sessionId: request.session.sessionId }); await Promise.resolve(); });
  expect(container.querySelector('[role="tab"]')).toBeNull();
});
