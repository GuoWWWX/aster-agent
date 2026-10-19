// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backgroundCommandSchema, type ConversationRunEvent } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { BackgroundPrograms, programPresentation } from "./background-programs.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
let root: Root | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
  useWorkbenchUiStore.setState({ backgroundCommandViewRequest: null });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([["mvn spring-boot:run", "Spring Boot"], ["./mvnw verify", "Maven"], ["gradlew build", "Gradle"], ["pnpm dev", "Node.js"], ["python3 app.py", "Python"], ["docker compose up", "Docker"], ["echo hello", "命令"]])("identifies %s as %s", (command, label) => { expect(programPresentation(command, null).label).toBe(label); });
it("shows status and stops the selected process through the scoped client API", async () => {
  const client = new MockAgentClient();
  const command = backgroundCommandSchema.parse({ conversationId: "00000000-0000-4000-8000-000000000001", commandId: "00000000-0000-4000-8000-000000000002", command: "mvn spring-boot:run", mode: "service", serviceName: "网关服务", workingDirectory: ".", startedAt: "2026-10-14T01:00:00Z", completedAt: null, status: "running", exitCode: null });
  const list = vi.spyOn(client, "listBackgroundCommands").mockResolvedValue([command]);
  const stop = vi.spyOn(client, "stopBackgroundCommand").mockResolvedValue({ ...command, status: "cancelled", completedAt: "2026-10-14T02:00:00Z" });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<BackgroundPrograms agentClient={client} conversationId={command.conversationId} />); await Promise.resolve(); });
  await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
  expect(document.body.textContent).toContain("网关服务"); expect(document.body.textContent).toContain("运行中");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="查看 网关服务 的执行情况"]')!.click(); await Promise.resolve(); });
  expect(useWorkbenchUiStore.getState().backgroundCommandViewRequest).toMatchObject({ conversationId: command.conversationId, commandId: command.commandId, name: "网关服务" });
  expect(useWorkbenchUiStore.getState().filePanelOpenByConversationId[command.conversationId]).toBe(true);
  expect(stop).not.toHaveBeenCalled();
  await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
  list.mockResolvedValue([{ ...command, status: "cancelled", completedAt: "2026-10-14T02:00:00Z" }]);
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="停止 网关服务"]')!.click(); await Promise.resolve(); });
  expect(stop).toHaveBeenCalledWith({ conversationId: command.conversationId, commandId: command.commandId });
  expect(document.body.textContent).toContain("已停止"); expect(document.querySelector('[aria-label="停止 网关服务"]')).toBeNull();
});

const ownerId = "00000000-0000-4000-8000-000000000011";
const childId = "00000000-0000-4000-8000-000000000012";
const childCommand = backgroundCommandSchema.parse({ conversationId: childId, commandId: "00000000-0000-4000-8000-000000000013", command: "node server.js", mode: "service", serviceName: "后代服务", workingDirectory: ".", startedAt: "2026-10-19T01:00:00Z", completedAt: null, status: "running", exitCode: null });
async function settle(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function mountMenu(client: MockAgentClient): (active: boolean) => Promise<void> {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  return async (active) => act(async () => { root?.render(<BackgroundPrograms active={active} agentClient={client} conversationId={ownerId} />); await settle(); });
}

it("does not subscribe, read, or poll when cached menus are hidden", async () => {
  vi.useFakeTimers();
  const client = new MockAgentClient();
  const list = vi.spyOn(client, "listBackgroundCommands").mockResolvedValue([childCommand]);
  const subscribe = vi.spyOn(client, "onConversationRunEvent");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => {
    root?.render(<>{Array.from({ length: 8 }, (_, index) => <BackgroundPrograms key={index} active={false} agentClient={client} conversationId={ownerId} />)}</>);
    await settle(); await vi.advanceTimersByTimeAsync(6_000);
  });
  expect(list).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});

it("stops hidden polling and catches up once on return without losing descendant commands", async () => {
  vi.useFakeTimers();
  const client = new MockAgentClient();
  const list = vi.spyOn(client, "listBackgroundCommands").mockResolvedValue([childCommand]);
  const listeners = new Set<(event: ConversationRunEvent) => void>();
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.add(listener); return () => listeners.delete(listener); });
  const show = mountMenu(client);
  await show(true); list.mockClear();
  await show(false);
  expect(listeners.size).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); await settle(); });
  expect(list).not.toHaveBeenCalled();
  await show(true);
  expect(list).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenLastCalledWith({ conversationId: ownerId });
  list.mockClear();
  await act(async () => {
    for (const listener of listeners) listener({ type: "run.finished", conversationId: childId, runId: "child-run", status: "completed", error: null });
    await settle();
  });
  expect(list).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenLastCalledWith({ conversationId: ownerId });
  expect(document.querySelector('[aria-label="查看后台程序"]')?.textContent).toContain("1");
});

it("ignores a read that resolves after hiding and returning to a newer snapshot", async () => {
  const client = new MockAgentClient();
  let resolveOld: (value: typeof childCommand[]) => void = () => {};
  const list = vi.spyOn(client, "listBackgroundCommands")
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue([]);
  const show = mountMenu(client);
  await show(true); await show(false); await show(true);
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => { resolveOld([childCommand]); await settle(); });
  expect(document.querySelector('[aria-label="查看后台程序"]')?.textContent).not.toContain("1");
});
