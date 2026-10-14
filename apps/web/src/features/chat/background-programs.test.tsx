// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backgroundCommandSchema } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { BackgroundPrograms, programPresentation } from "./background-programs.js";
let root: Root | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([["mvn spring-boot:run", "Spring Boot"], ["./mvnw verify", "Maven"], ["gradlew build", "Gradle"], ["pnpm dev", "Node.js"], ["python3 app.py", "Python"], ["docker compose up", "Docker"], ["echo hello", "命令"]])("identifies %s as %s", (command, label) => { expect(programPresentation(command, null).label).toBe(label); });
it("shows status and stops the selected process through the scoped client API", async () => {
  const client = new MockAgentClient();
  const command = backgroundCommandSchema.parse({ conversationId: "00000000-0000-4000-8000-000000000001", commandId: "00000000-0000-4000-8000-000000000002", command: "mvn spring-boot:run", mode: "service", serviceName: "网关服务", workingDirectory: ".", startedAt: "2026-10-14T01:00:00Z", completedAt: null, status: "running", exitCode: null });
  vi.spyOn(client, "listBackgroundCommands").mockResolvedValue([command]);
  const stop = vi.spyOn(client, "stopBackgroundCommand").mockResolvedValue({ ...command, status: "cancelled", completedAt: "2026-10-14T02:00:00Z" });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<BackgroundPrograms agentClient={client} conversationId={command.conversationId} />); await Promise.resolve(); });
  await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
  expect(document.body.textContent).toContain("网关服务"); expect(document.body.textContent).toContain("运行中");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="停止 网关服务"]')!.click(); await Promise.resolve(); });
  expect(stop).toHaveBeenCalledWith({ conversationId: command.conversationId, commandId: command.commandId });
  expect(document.body.textContent).toContain("已停止"); expect(document.querySelector('[aria-label="停止 网关服务"]')).toBeNull();
});
