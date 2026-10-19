import { randomUUID } from "node:crypto";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_TERMINAL_CONFIGURATION } from "@agent/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ spawn: vi.fn<(executable: string, args: string[], options: SpawnOptions) => Child>(), terminate: vi.fn<(pid: number) => Promise<void>>() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./terminate-process-tree.js", () => ({ terminateProcessTree: mocks.terminate }));

import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry, type CommandOutputEvent, type PreparedCommand, type ProjectOperationOwner, type ToolExecution } from "./project-tool-registry.js";

class Child extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly kill = vi.fn(() => true);
  public constructor(public readonly pid: number) { super(); }
  public close(code: number | null = 0): void { this.emit("close", code); }
}

const children: Child[] = [];
const fixtures: { root: string; tools: ProjectToolRegistry }[] = [];
const owner = (): ProjectOperationOwner => ({ conversationId: randomUUID(), conversationTitle: "Command test", runId: randomUUID() });
const signal = () => new AbortController().signal;
const value = (result: ToolExecution) => z.object({ value: z.record(z.string(), z.unknown()) }).parse(JSON.parse(result.content)).value;
const idOf = (result: ToolExecution) => z.string().uuid().parse(value(result).commandId);

async function fixture(configuration = () => structuredClone(DEFAULT_TERMINAL_CONFIGURATION)) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-command-lifecycle-"));
  const projects = new ProjectRegistry();
  const project = await projects.registerDirectory(root);
  const tools = new ProjectToolRegistry(projects, { getConfiguration: configuration });
  fixtures.push({ root, tools });
  return { tools, project, projects };
}

async function prepare(tools: ProjectToolRegistry, projectId: string | undefined, commandOwner: ProjectOperationOwner, options: Partial<PreparedCommand> = {}) {
  const proposal = await tools.execute("run_command", JSON.stringify({ command: "echo test", mode: "service", timeoutMs: null, yieldTimeMs: 0, ...options }), projectId, signal(), commandOwner);
  if (proposal.kind !== "command") throw new Error(proposal.content);
  return proposal.command;
}

async function start(tools: ProjectToolRegistry, projectId: string | undefined, commandOwner: ProjectOperationOwner, options: Partial<PreparedCommand> = {}, commandSignal = signal(), output?: (event: CommandOutputEvent) => void) {
  return tools.executePreparedCommand(await prepare(tools, projectId, commandOwner, options), projectId, commandSignal, commandOwner, output);
}

beforeEach(() => {
  mocks.spawn.mockImplementation(() => {
    const child = new Child(50_000 + children.length);
    children.push(child);
    return child;
  });
  mocks.terminate.mockImplementation(pid => { children.find(child => child.pid === pid)?.close(null); return Promise.resolve(); });
});

afterEach(async () => {
  for (const child of children) child.close();
  await Promise.all(fixtures.splice(0).map(async ({ root, tools }) => {
    await tools.dispose();
    await rm(root, { recursive: true, force: true });
  }));
  children.splice(0);
  mocks.spawn.mockReset();
  mocks.terminate.mockReset();
  vi.useRealTimers();
});

describe("Project command lifecycle contracts", () => {
  it("prepares without spawning, freezes controlled shell/encoding before workspace lookup and preserves inherited paths", async () => {
    const configuration = vi.fn(() => ({ ...DEFAULT_TERMINAL_CONFIGURATION, outputEncoding: "utf-8" as const, shell: "cmd" as const, shellPaths: { ...DEFAULT_TERMINAL_CONFIGURATION.shellPaths, cmd: "C:/custom/cmd.exe" } }));
    const { tools, project, projects } = await fixture(configuration);
    const commandOwner = owner();
    const prepared = await prepare(tools, project.id, commandOwner);
    expect(mocks.spawn).not.toHaveBeenCalled();
    const order: string[] = [];
    configuration.mockImplementation(() => { order.push("config"); return { ...DEFAULT_TERMINAL_CONFIGURATION, outputEncoding: "utf-8", shell: "cmd", shellPaths: { ...DEFAULT_TERMINAL_CONFIGURATION.shellPaths, cmd: "C:/custom/cmd.exe" } }; });
    const ensure = projects.ensureWorkspaceRoot.bind(projects);
    vi.spyOn(projects, "ensureWorkspaceRoot").mockImplementation(async id => { order.push("workspace"); return ensure(id); });
    await tools.executePreparedCommand(prepared, project.id, signal(), commandOwner);
    expect(order).toEqual(["config", "workspace"]);
    const [executable, args, options] = mocks.spawn.mock.calls[0] ?? [];
    expect(executable).toBe(process.platform === "win32" ? "powershell.exe" : "pwsh");
    expect(args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command", expect.stringContaining("echo test")]));
    expect(options).toMatchObject({ cwd: project.rootPath, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    expect(options?.env).toMatchObject(Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "psmodulepath"].includes(key.toLowerCase()))));
    const commandId = idOf(await tools.execute("read_command_output", JSON.stringify({ commandId: tools.listConversationCommands([commandOwner.conversationId])[0]?.commandId, yieldTimeMs: 0 }), project.id, signal(), commandOwner));
    expect(commandId).toBeTruthy();
  });

  it("streams an initial event, split Unicode output, and exactly one terminal flush per stream despite duplicate close", async () => {
    const { tools, project } = await fixture(() => ({ ...DEFAULT_TERMINAL_CONFIGURATION, outputEncoding: "utf-8" }));
    const events: CommandOutputEvent[] = [];
    const commandOwner = owner();
    const result = await start(tools, project.id, commandOwner, {}, signal(), event => events.push(event));
    const bytes = Buffer.from("你好\n");
    children[0]?.stdout.emit("data", bytes.subarray(0, 2));
    children[0]?.stdout.emit("data", bytes.subarray(2));
    children[0]?.stderr.emit("data", Buffer.from("problem"));
    children[0]?.close(3);
    children[0]?.close(0);
    expect(await result.commandCompletion).toMatchObject({ isError: true });
    expect(events[0]).toMatchObject({ delta: "", done: false, stream: "stdout", status: "running", exitCode: null });
    expect(events.filter(event => !event.done).map(event => event.delta).join("")).toBe("你好\nproblem");
    expect(events.filter(event => event.done).map(event => [event.stream, event.status, event.exitCode])).toEqual([["stdout", "failed", 3], ["stderr", "failed", 3]]);
    expect(tools.readConversationCommand(idOf(result), [commandOwner.conversationId])).toMatchObject({ stdout: "你好\n", stderr: "problem", command: { status: "failed", exitCode: 3 } });
  });

  it("caps each stream at its first 200000 bytes and ignores observer exceptions", async () => {
    const { tools, project } = await fixture();
    const commandOwner = owner();
    const result = await start(tools, project.id, commandOwner, {}, signal(), () => { throw new Error("observer failed"); });
    for (const stream of ["stdout", "stderr"] as const) {
      children[0]?.[stream].emit("data", Buffer.from("x".repeat(200_000) + "discard"));
      children[0]?.[stream].emit("data", Buffer.from("also discard"));
    }
    children[0]?.close();
    const final = value(await result.commandCompletion ?? result);
    expect(final).toMatchObject({ status: "completed", truncated: true, nextStdoutOffset: 200_000, nextStderrOffset: 200_000 });
    expect(final.stdout).toBe("x".repeat(200_000));
    expect(final.stderr).toBe("x".repeat(200_000));
  });

  it.each(["abort", "timeout"] as const)("terminates the owned tree once for %s and keeps the original terminal status", async cause => {
    const { tools, project } = await fixture();
    vi.useFakeTimers();
    const controller = new AbortController();
    const commandOwner = owner();
    const result = await start(tools, project.id, commandOwner, { timeoutMs: 1000 }, controller.signal);
    if (cause === "abort") { controller.abort(); controller.abort(); } else await vi.advanceTimersByTimeAsync(1000);
    const final = value(await result.commandCompletion ?? result);
    expect(final).toMatchObject({ status: cause === "abort" ? "cancelled" : "failed", timedOut: cause === "timeout" });
    expect(mocks.terminate).toHaveBeenCalledExactlyOnceWith(children[0]?.pid);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not spawn for a pre-aborted application and releases a batch lock after child startup error", async () => {
    const { tools, project } = await fixture();
    const commandOwner = owner();
    const command = await prepare(tools, project.id, commandOwner, { mode: "batch" });
    const controller = new AbortController(); controller.abort();
    await expect(tools.executePreparedCommand(command, project.id, controller.signal, commandOwner)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.spawn).not.toHaveBeenCalled();
    const result = await tools.executePreparedCommand(command, project.id, signal(), commandOwner);
    children[0]?.emit("error", new Error("fixture startup failure"));
    const final = value(await result.commandCompletion ?? result);
    expect(final).toMatchObject({ status: "failed", exitCode: null });
    expect(final.error).toContain("fixture startup failure");
    await expect(start(tools, project.id, owner())).resolves.toMatchObject({ isError: false });
  });

  it("holds yielded batch locks, allows same-run parallel commands, and releases service locks on start", async () => {
    const { tools, project } = await fixture();
    const commandOwner = owner();
    const first = await start(tools, project.id, commandOwner, { mode: "batch" });
    await expect(start(tools, project.id, commandOwner, { mode: "batch" })).resolves.toMatchObject({ isError: false });
    const conflict = await start(tools, project.id, owner());
    expect(conflict.isError).toBe(true);
    expect(conflict.content).toContain("PROJECT_OPERATION_CONFLICT");
    expect(await start(tools, project.id, commandOwner, { mode: "batch", parallel: false })).toMatchObject({ isError: true });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    children[0]?.close(); children[1]?.close();
    await first.commandCompletion;
    await expect(start(tools, project.id, owner())).resolves.toMatchObject({ isError: false });
    await expect(start(tools, project.id, owner())).resolves.toMatchObject({ isError: false });
    expect(mocks.spawn).toHaveBeenCalledTimes(4);
  });

  it("keeps model read/list owner-only, project wait/stop shared, and UI operations within the supplied conversation tree", async () => {
    const { tools, project, projects } = await fixture();
    const commandOwner = owner(); const other = owner();
    const first = await start(tools, project.id, commandOwner);
    const commandId = idOf(first);
    expect(value(await tools.execute("list_background_commands", "{}", project.id, signal(), other)).commands).toEqual([]);
    expect(await tools.execute("read_command_output", JSON.stringify({ commandId, yieldTimeMs: 0 }), project.id, signal(), other)).toMatchObject({ isError: true });
    expect(tools.listConversationCommands([other.conversationId])).toEqual([]);
    expect(tools.listConversationCommands([other.conversationId, commandOwner.conversationId])).toHaveLength(1);
    expect(() => tools.readConversationCommand(commandId, [other.conversationId])).toThrow("当前对话");
    await expect(tools.stopConversationCommand(commandId, [other.conversationId])).rejects.toThrow("当前对话");
    const secondProject = await projects.registerDirectory(await mkdtemp(path.join(project.rootPath, "other-project-")));
    expect(await tools.execute("stop_command", JSON.stringify({ commandId }), secondProject.id, signal(), other)).toMatchObject({ isError: true });
    expect(await tools.execute("wait_for_commands", JSON.stringify({ commandIds: [commandId] }), secondProject.id, signal(), other)).toMatchObject({ isError: true });
    const waiting = tools.execute("wait_for_commands", JSON.stringify({ commandIds: [commandId, commandId], waitFor: "all", timeoutMs: 1000 }), project.id, signal(), other);
    expect(await tools.execute("stop_command", JSON.stringify({ commandId }), project.id, signal(), other)).toMatchObject({ isError: false });
    expect(value(await waiting)).toMatchObject({ waitStatus: "finished", commands: [expect.objectContaining({ status: "cancelled" })] });
    expect(tools.readConversationCommand(commandId, [other.conversationId, commandOwner.conversationId]).command.status).toBe("cancelled");
    await expect(tools.stopConversationCommand(commandId, [other.conversationId, commandOwner.conversationId])).resolves.toMatchObject({ status: "cancelled" });
    expect(Object.keys(z.object({ command: z.record(z.string(), z.unknown()) }).parse(value(await tools.execute("stop_command", JSON.stringify({ commandId }), project.id, signal(), other))).command).sort()).toEqual(["commandId", "completedAt", "error", "exitCode", "status"]);
  });

  it("isolates temporary command access and reuses one temporary root per conversation", async () => {
    const { tools } = await fixture();
    const commandOwner = owner(); const other = owner();
    const result = await start(tools, undefined, commandOwner);
    const commandId = idOf(result);
    const second = await start(tools, undefined, commandOwner);
    const third = await start(tools, undefined, other);
    expect(value(second).workingDirectory).toBe(value(result).workingDirectory);
    expect(value(third).workingDirectory).not.toBe(value(result).workingDirectory);
    for (const name of ["stop_command", "wait_for_commands"] as const) {
      const args = name === "stop_command" ? { commandId } : { commandIds: [commandId] };
      expect(await tools.execute(name, JSON.stringify(args), undefined, signal(), other)).toMatchObject({ isError: true });
    }
    for (const directory of new Set([value(result).workingDirectory, value(third).workingDirectory])) await rm(z.string().parse(directory), { recursive: true, force: true });
  });

  it("waiting timeout or cancellation does not terminate a command, and any/all retain their readiness semantics", async () => {
    const { tools, project } = await fixture();
    vi.useFakeTimers();
    const commandOwner = owner();
    const first = await start(tools, project.id, commandOwner);
    const second = await start(tools, project.id, commandOwner);
    const ids = [idOf(first), idOf(second)];
    const timed = tools.execute("wait_for_commands", JSON.stringify({ commandIds: ids, timeoutMs: 1000 }), project.id, signal(), commandOwner);
    await vi.advanceTimersByTimeAsync(1000);
    expect(value(await timed).waitStatus).toBe("timeout");
    const controller = new AbortController();
    const cancelled = tools.execute("wait_for_commands", JSON.stringify({ commandIds: ids }), project.id, controller.signal, commandOwner).catch((error: unknown) => error);
    controller.abort();
    expect(await cancelled).toMatchObject({ name: "AbortError" });
    const any = tools.execute("wait_for_commands", JSON.stringify({ commandIds: ids, waitFor: "any" }), project.id, signal(), commandOwner);
    children[0]?.close();
    expect(value(await any).waitStatus).toBe("finished");
    expect(value(await tools.execute("wait_for_commands", JSON.stringify({ commandIds: [ids[0]] }), project.id, signal(), commandOwner)).waitStatus).toBe("finished");
    expect(mocks.terminate).not.toHaveBeenCalled();
    expect(tools.listConversationCommands([commandOwner.conversationId]).find(item => item.commandId === ids[1])?.status).toBe("running");
  });

  it("disposal waits for termination promises, surfaces cleanup failures, and clears only its own sessions", async () => {
    const { tools, project } = await fixture();
    const commandOwner = owner();
    const result = await start(tools, project.id, commandOwner);
    let rejectTermination: (reason: Error) => void = () => undefined;
    const termination = new Promise<void>((_resolve, reject) => { rejectTermination = reject; });
    mocks.terminate.mockReturnValue(termination);
    let done = false;
    const disposal = tools.dispose().finally(() => { done = true; });
    const failed = expect(disposal).rejects.toThrow("Command process cleanup failed");
    children[0]?.close(null);
    await result.commandCompletion;
    expect(done).toBe(false);
    rejectTermination(new Error("fixture tree stop failed"));
    await failed;
    expect(children[0]?.kill).toHaveBeenCalledOnce();
    expect(tools.listConversationCommands([commandOwner.conversationId])).toEqual([]);
  });

  it("prunes completed command logs with old operations while retaining a still-running service", async () => {
    const { tools, project } = await fixture();
    const commandOwner = owner();
    const running = await start(tools, project.id, commandOwner);
    const completed = await start(tools, project.id, commandOwner);
    children[1]?.close();
    for (let count = 0; count < 101; count += 1) {
      await start(tools, project.id, commandOwner);
      children.at(-1)?.close();
    }
    expect(tools.readConversationCommand(idOf(running), [commandOwner.conversationId]).command.status).toBe("running");
    expect(() => tools.readConversationCommand(idOf(completed), [commandOwner.conversationId])).toThrow("当前对话");
  });

  it("disposes one registry without stopping a different runner's owned process", async () => {
    const first = await fixture(); const second = await fixture();
    const commandOwner = owner();
    await start(first.tools, first.project.id, commandOwner);
    const other = await start(second.tools, second.project.id, commandOwner);
    await first.tools.dispose();
    expect(mocks.terminate).toHaveBeenCalledExactlyOnceWith(children[0]?.pid);
    expect(second.tools.readConversationCommand(idOf(other), [commandOwner.conversationId]).command.status).toBe("running");
  });
});
