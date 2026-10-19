import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: native.spawn }));
import { WindowsComputerController } from "./windows-computer-controller.js";
import { toMainAgentError } from "../errors/agent-error.js";

const controllers: WindowsComputerController[] = [];
const sockets: Socket[] = [];
afterEach(() => { controllers.splice(0).forEach((value) => value.stop()); sockets.splice(0).forEach((value) => value.destroy()); vi.restoreAllMocks(); });
function fixture(permissions: ConstructorParameters<typeof WindowsComputerController>[1] = null) {
  native.spawn.mockReset();
  let configuration: ComputerUseConfiguration = { ...structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION), enabled: true,
    applications: [{ id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: true }] };
  const requests: { id: string; command: unknown; applications: unknown; expectedExecutablePath?: string | undefined }[] = [];
  let peer: Socket | undefined;
  native.spawn.mockImplementation((_file: string, args: string[]) => {
    const child = new EventEmitter(); Object.assign(child, { kill: vi.fn(() => { child.emit("exit", 0); return true; }) });
    const pipe = args[args.indexOf("-PipeName") + 1]; const token = args[args.indexOf("-Token") + 1];
    peer = createConnection(`\\\\.\\pipe\\${pipe}`); sockets.push(peer); peer.setEncoding("utf8");
    peer.once("connect", () => peer?.write(`${JSON.stringify({ token, elevated: false })}\n`));
    let buffer = "";
    peer.on("data", (chunk: string) => { buffer += chunk; while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"); const request = z.object({ id: z.string(), command: z.object({ action: z.string() }).passthrough(), applications: z.unknown(), expectedExecutablePath: z.string().optional() }).parse(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1);
      if (request.command.action === "identify") peer?.write(`${JSON.stringify({ id: request.id, ok: true, value: { executablePath: "C:\\Editor.exe" } })}\n`);
      else requests.push(request);
    } });
    return child;
  });
  const controller = new WindowsComputerController({ getConfiguration: () => configuration }, permissions); controllers.push(controller);
  return { controller, requests, disconnect: () => peer?.destroy(), failOperation: (index: number, code: string) => peer?.write(`${JSON.stringify({ id: requests[index]?.id, ok: false, code })}\n`), reply: (index: number, value: unknown = { windows: [] }) => peer?.write(`${JSON.stringify({ id: requests[index]?.id, ok: true, value })}\n`), set: (value: Partial<ComputerUseConfiguration>) => { configuration = { ...configuration, ...value }; } };
}
describe.runIf(process.platform === "win32")("Windows computer transport", () => {
  it("lets the agent start the configured session and stop without settings-page actions", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    expect(await f.controller.execute({ action: "status" }, signal)).toMatchObject({ ok: true, value: { running: false } });
    expect(await f.controller.execute({ action: "start" }, signal)).toMatchObject({ ok: true, value: { running: true, elevated: false } });
    expect(await f.controller.execute({ action: "start" }, signal)).toMatchObject({ ok: true });
    expect(native.spawn).toHaveBeenCalledOnce();
    expect(await f.controller.execute({ action: "stop" }, signal)).toMatchObject({ ok: true, value: { running: false } });
    expect(await f.controller.execute({ action: "start" }, signal)).toMatchObject({ ok: false, code: "COMPUTER_CONTROL_STOPPED" });
    expect(native.spawn).toHaveBeenCalledOnce();
    expect(await f.controller.execute({ action: "start" }, new AbortController().signal)).toMatchObject({ ok: true });
    expect(native.spawn).toHaveBeenCalledTimes(2);
  });
  it("cannot rejoin or restart a session after emergency stop in the same run", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    await f.controller.execute({ action: "start" }, signal); f.disconnect();
    await vi.waitFor(() => expect(f.controller.getStatus().running).toBe(false));
    expect(await f.controller.execute({ action: "start" }, signal)).toMatchObject({ ok: false, code: "COMPUTER_CONTROL_STOPPED" });
    await f.controller.start();
    expect(await f.controller.execute({ action: "list" }, signal)).toMatchObject({ ok: false, code: "COMPUTER_CONTROL_STOPPED" });
    expect(await f.controller.execute({ action: "start" }, signal)).toMatchObject({ ok: false, code: "COMPUTER_CONTROL_STOPPED" });
    expect(native.spawn).toHaveBeenCalledTimes(2);
  });
  it("cancels agent startup while waiting for the native handshake", async () => {
    const f = fixture(); const abort = new AbortController();
    native.spawn.mockImplementation(() => Object.assign(new EventEmitter(), { kill: vi.fn() }));
    const starting = f.controller.execute({ action: "start" }, abort.signal);
    const rejected = expect(starting).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
    await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledOnce()); abort.abort(); await rejected;
    expect(f.controller.getStatus().running).toBe(false); expect(native.spawn).toHaveBeenCalledOnce();
  });
  it("serializes all callers and transfers only current allowlist facts", async () => {
    const f = fixture(); await f.controller.start();
    expect(f.controller.getStatus()).toMatchObject({ running: true, elevated: false });
    const first = f.controller.execute({ action: "list" }, new AbortController().signal);
    const second = f.controller.execute({ action: "observe", windowId: "123" }, new AbortController().signal);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    expect(f.requests[0]?.applications).toEqual([expect.objectContaining({ executablePath: "C:\\Editor.exe" })]); f.reply(0); await first;
    await vi.waitFor(() => expect(f.requests).toHaveLength(2)); f.reply(1); await second;
    f.controller.stop(); expect(f.controller.getStatus().running).toBe(false);
    expect(await f.controller.execute({ action: "list" }, new AbortController().signal)).toEqual({ ok: false, code: "COMPUTER_START_REQUIRED" });
    expect(native.spawn).toHaveBeenCalledOnce();
  });
  it("denies revoked configuration and never starts implicitly from a read operation", async () => {
    const f = fixture(); f.set({ enabled: false });
    expect(await f.controller.execute({ action: "list" }, new AbortController().signal)).toEqual({ ok: false, code: "COMPUTER_USE_DISABLED" });
    f.set({ enabled: true, administrator: true });
    expect(await f.controller.execute({ action: "list" }, new AbortController().signal)).toEqual({ ok: false, code: "ADMINISTRATOR_START_REQUIRED" });
    expect(native.spawn).not.toHaveBeenCalled();
  });
  it("cancels pending input, disconnects the helper and does not replay queued aborted input", async () => {
    const f = fixture(); await f.controller.start(); const abort = new AbortController();
    const pending = f.controller.execute({ action: "type", windowId: "123", text: "one" }, abort.signal);
    const rejected = expect(pending).rejects.toThrow("取消");
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); abort.abort(); await rejected;
    expect(f.controller.getStatus().running).toBe(false);
    await expect(f.controller.execute({ action: "type", windowId: "123", text: "two" }, abort.signal)).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
  });
  it("uses the UAC launcher only on explicit startup and reports rejected elevation", async () => {
    const f = fixture(); f.set({ administrator: true });
    native.spawn.mockImplementation((_file: string, args: string[]) => {
      const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1]!, "base64").toString("utf16le");
      expect(script).toContain("-Verb RunAs -WindowStyle Hidden");
      const child = new EventEmitter(); Object.assign(child, { kill: vi.fn() }); queueMicrotask(() => child.emit("exit", 1)); return child;
    });
    const error: unknown = await f.controller.start().catch((reason: unknown) => reason);
    expect(toMainAgentError(error, { operation: "ipc:computer_use.start" })).toMatchObject({ code: "PERMISSION_DENIED", message: "管理员启动被取消或失败，请在设置中重试。" });
    expect(f.controller.getStatus()).toMatchObject({ running: false, elevated: false });
  });
  it("cancels pending and queued actions when the helper exits through the emergency key", async () => {
    const f = fixture(); await f.controller.start();
    const pending = f.controller.execute({ action: "type", windowId: "123", text: "one" }, new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
    const queued = f.controller.execute({ action: "type", windowId: "123", text: "two" }, new AbortController().signal);
    const rejectedQueued = expect(queued).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); f.disconnect(); await rejected;
    await rejectedQueued;
    expect(f.controller.getStatus()).toMatchObject({ running: false, elevated: false });
    expect(f.requests).toHaveLength(1); expect(native.spawn).toHaveBeenCalledOnce();
  });
  it("keeps the control session alive when ordinary user input changes focus or holds a modifier", async () => {
    const f = fixture(); await f.controller.start();
    for (const code of ["USER_INPUT_ACTIVE", "FOCUS_CHANGED", "WINDOW_OCCLUDED"]) {
      const index = f.requests.length;
      const operation = f.controller.execute({ action: "click", windowId: "123", x: 12, y: 12, button: "left", count: 1 }, new AbortController().signal);
      await vi.waitFor(() => expect(f.requests).toHaveLength(index + 1)); f.failOperation(index, code);
      expect(await operation).toMatchObject({ ok: false, code }); expect(f.controller.getStatus().running).toBe(true);
    }
    const resumed = f.controller.execute({ action: "list" }, new AbortController().signal);
    await vi.waitFor(() => expect(f.requests).toHaveLength(4)); f.reply(3); expect(await resumed).toMatchObject({ ok: true });
    expect(native.spawn).toHaveBeenCalledOnce();
  });
  it("lists stable software identities without leaking unapproved window titles or executable paths", async () => {
    const f = fixture(); f.set({ applications: [] }); await f.controller.start();
    let applicationId = "";
    for (let index = 0; index < 2; index++) {
      const listing = f.controller.execute({ action: "list" }, new AbortController().signal);
      await vi.waitFor(() => expect(f.requests).toHaveLength(index + 1));
      f.reply(index, { windows: [{ windowId: "123", title: "private contents", executablePath: "C:\\Editor.exe" }] });
      const result = await listing; expect(JSON.stringify(result)).not.toContain("private contents"); expect(JSON.stringify(result)).not.toContain("Editor.exe");
      if (!result.ok) throw new Error(result.code);
      const windows = z.object({ windows: z.array(z.object({ applicationId: z.string(), authorized: z.boolean() })) }).parse(result.value).windows;
      expect(windows[0]?.authorized).toBe(false);
      if (index === 0) applicationId = windows[0]!.applicationId; else expect(windows[0]?.applicationId).toBe(applicationId);
    }
    expect(await f.controller.execute({ action: "observe", windowId: "123" }, new AbortController().signal)).toMatchObject({ ok: false, code: "APPLICATION_ACCESS_DENIED" });
    expect(f.requests).toHaveLength(2);
  });
  it("asks software permission before reading and checks it even when tool approval has already passed", async () => {
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: true };
    let allowed = false;
    const authorize = vi.fn(() => { allowed = true; return Promise.resolve(true); });
    const f = fixture({ describe: () => application, state: () => allowed ? "allowed" : "ask", authorize, grants: () => allowed ? [application] : [], clearSession: vi.fn() });
    f.set({ applications: [] }); await f.controller.start();
    const reading = f.controller.execute({ action: "observe", windowId: "123" }, new AbortController().signal);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1)); expect(authorize).toHaveBeenCalledOnce();
    expect(f.requests[0]?.expectedExecutablePath).toBe(application.executablePath);
    expect(f.requests[0]?.applications).toEqual(expect.arrayContaining([application])); f.reply(0, { elements: [] });
    expect(await reading).toMatchObject({ ok: true });
  });
  it("aborts software authorization on Escape/stop without dispatching the waiting operation", async () => {
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: true };
    const authorize = vi.fn((_application: unknown, signal: AbortSignal) => new Promise<boolean>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("授权已取消")), { once: true })));
    const clearSession = vi.fn();
    const f = fixture({ describe: () => application, state: () => "ask", authorize, grants: () => [], clearSession });
    f.set({ applications: [] }); await f.controller.start();
    const operation = f.controller.execute({ action: "observe", windowId: "123" }, new AbortController().signal);
    const rejected = expect(operation).rejects.toThrow("取消");
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce()); f.controller.stop(); await rejected;
    expect(clearSession).toHaveBeenCalled(); expect(f.requests).toHaveLength(0);
  });
  it("allows all-software mode to launch a known app even when its individual permanent grant is disabled", async () => {
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: false };
    const f = fixture(); f.set({ accessMode: "all", applications: [application] }); await f.controller.start();
    const launching = f.controller.execute({ action: "launch", applicationId: application.id }, new AbortController().signal);
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    expect(f.requests[0]?.applications).toEqual(expect.arrayContaining([{ ...application, enabled: true }]));
    f.reply(0, { launched: true }); expect(await launching).toMatchObject({ ok: true });
  });
});
