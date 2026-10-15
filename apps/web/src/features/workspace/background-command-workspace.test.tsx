// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backgroundCommandSchema } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { createProjectSession } from "../projects/project-session-model.js";
import { useProjectTree } from "../projects/use-project-tree.js";
import { BackgroundCommandWorkspace } from "./background-command-workspace.js";
import { RightSidebarWorkspace } from "./right-sidebar-workspace.js";
let root: Root | undefined;
const command = backgroundCommandSchema.parse({ commandId: "00000000-0000-4000-8000-000000000002", conversationId: "00000000-0000-4000-8000-000000000001", command: "ping -t baidu.com", serviceName: "持续 Ping", mode: "service", workingDirectory: "workspace", status: "running", exitCode: null, startedAt: "2026-10-14T01:00:00Z", completedAt: null });
const output = { command, stdout: "reply one\n", stderr: "", error: null, timedOut: false, truncated: false };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useWorkbenchUiStore.setState({ activeActivity: "conversations", backgroundCommandViewRequest: null, filePanelOpenByConversationId: {} });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function renderViewer(client: MockAgentClient, active = true): Promise<HTMLDivElement> {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><BackgroundCommandWorkspace agentClient={client} conversationId={command.conversationId} commandId={command.commandId} active={active} /></TooltipProvider>); await Promise.resolve(); });
  return container;
}
it("refreshes live output, stops the process and shows its final exit state", async () => {
  vi.useFakeTimers();
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "readBackgroundCommand").mockResolvedValueOnce(output).mockResolvedValueOnce({ ...output, stdout: "reply one\nreply two\n" })
    .mockResolvedValue({ ...output, command: { ...command, status: "cancelled", exitCode: 0, completedAt: "2026-10-14T02:00:00Z" } });
  const stop = vi.spyOn(client, "stopBackgroundCommand").mockResolvedValue({ ...command, status: "cancelled" });
  const container = await renderViewer(client);
  expect(read).toHaveBeenCalledWith({ conversationId: command.conversationId, commandId: command.commandId });
  expect(container.textContent).toContain("reply one");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.textContent).toContain("reply two");
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="停止程序及其子进程"]')!.click(); await Promise.resolve(); });
  expect(stop).toHaveBeenCalledWith({ conversationId: command.conversationId, commandId: command.commandId });
  expect(container.textContent).toContain("已停止"); expect(container.textContent).toContain("退出码 0");
  expect(container.querySelector('[aria-label="停止程序及其子进程"]')).toBeNull();
  const count = read.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(read).toHaveBeenCalledTimes(count);
});
it("shows failed command stderr and does not read while the tab is inactive", async () => {
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "readBackgroundCommand").mockResolvedValue({ ...output, stdout: "", stderr: "编译失败", command: { ...command, status: "failed", exitCode: 2 }, truncated: true });
  const container = await renderViewer(client, false);
  expect(read).not.toHaveBeenCalled();
  await act(async () => { root?.render(<TooltipProvider><BackgroundCommandWorkspace agentClient={client} conversationId={command.conversationId} commandId={command.commandId} active /></TooltipProvider>); await Promise.resolve(); });
  expect(container.textContent).toContain("编译失败"); expect(container.textContent).toContain("退出码 2"); expect(container.textContent).toContain("仅显示最近输出");
});
it("copies the command and its output separately through the host clipboard", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "readBackgroundCommand").mockResolvedValue({ ...output, stderr: "error details", command: { ...command, status: "completed" } });
  const copy = vi.spyOn(client, "writeClipboardText").mockResolvedValue(undefined);
  const browserCopy = vi.fn().mockRejectedValue(new Error("Browser clipboard denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText: browserCopy } });
  const container = await renderViewer(client);
  const commandButton = container.querySelector<HTMLButtonElement>('[aria-label="执行命令"] [aria-label="复制命令"]');
  const outputButton = container.querySelector<HTMLButtonElement>('[aria-label="执行输出"] [aria-label="复制执行输出"]');
  expect(commandButton).not.toBeNull(); expect(outputButton).not.toBeNull();
  expect(container.querySelector('header [aria-label^="复制"]')).toBeNull();
  await act(async () => { commandButton?.click(); await Promise.resolve(); });
  expect(copy).toHaveBeenLastCalledWith(command.command);
  await act(async () => { outputButton?.click(); await Promise.resolve(); });
  expect(copy).toHaveBeenLastCalledWith("reply one\nerror details");
  expect(browserCopy).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="已复制执行输出"]')).not.toBeNull();
});
it("keeps clipboard errors separate from the command read status and allows retry", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "readBackgroundCommand").mockResolvedValue(output);
  const copy = vi.spyOn(client, "writeClipboardText").mockRejectedValueOnce(new Error("Clipboard unavailable")).mockResolvedValue(undefined);
  const container = await renderViewer(client);
  const button = container.querySelector<HTMLButtonElement>('[aria-label="复制执行输出"]');
  await act(async () => { button?.click(); await Promise.resolve(); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("无法复制执行输出。");
  expect(container.querySelector("header")?.textContent).toContain("运行中");
  expect(container.textContent).not.toContain("已暂停更新");
  await act(async () => { button?.click(); await Promise.resolve(); });
  expect(copy).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("opens one right-side detail tab in a projectless conversation and closing it keeps the process alive", async () => {
  const client = new MockAgentClient(); const conversation = await client.createConversation({ projectId: null });
  const target = createProjectSession(null, [], conversation.id);
  vi.spyOn(client, "readBackgroundCommand").mockResolvedValue(output);
  const stop = vi.spyOn(client, "stopBackgroundCommand");
  function Harness() {
    const tree = useProjectTree(client);
    return <TooltipProvider><RightSidebarWorkspace activeProject={null} activeSession={target} agentClient={client} tree={tree}
      fileOpenRequest={null} teamMemberOpenRequest={null} onLocateProject={() => {}} onLocateSession={() => {}}
      onSessionUpdated={() => {}} onSessionViewed={() => {}} /></TooltipProvider>;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  const open = async (): Promise<void> => {
    await act(async () => { useWorkbenchUiStore.getState().openBackgroundCommandView({ conversationId: target.id, commandId: command.commandId, name: "持续 Ping" }); await Promise.resolve(); });
  };
  await open(); await open();
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(container.querySelector('[role="tab"]')?.textContent).toContain("运行：持续 Ping");
  expect(container.querySelector('[aria-label="后台命令执行详情"]')).not.toBeNull();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="关闭 运行：持续 Ping"]')!.click(); await Promise.resolve(); });
  expect(container.querySelector('[aria-label="后台命令执行详情"]')).toBeNull(); expect(stop).not.toHaveBeenCalled();
});
