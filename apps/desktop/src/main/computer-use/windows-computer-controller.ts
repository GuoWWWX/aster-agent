import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { computerApplicationSchema, computerUseArgumentsSchema, type ComputerApplication, type AgentErrorCode, type ComputerUseArguments, type ComputerUseConfiguration, type ComputerUseStatus } from "@agent/protocol";
import type { ComputerApplicationPermissions } from "./computer-application-permissions.js";
import driverSource from "./windows-driver.ps1";

export type ComputerResponse = { ok: true; value: Record<string, unknown> } | { ok: false; code: string };
export interface ComputerControlPort {
  getStatus(): ComputerUseStatus;
  start(): Promise<ComputerUseStatus>;
  stop(): void;
  execute(command: ComputerUseArguments, signal: AbortSignal): Promise<ComputerResponse>;
}
const responseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.uuid(), ok: z.literal(true), value: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ id: z.uuid(), ok: z.literal(false), code: z.string().max(100) }).strict(),
]);
const readySchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/u), elevated: z.boolean() }).strict();
const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const windowMetadataSchema = z.object({ windowId: z.string().regex(/^\d{1,20}$/u), title: z.string().max(512), executablePath: computerApplicationSchema.shape.executablePath }).strict();
function controlError(code: AgentErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code, id: randomUUID(), retryable: false });
}

/** One input stream for the desktop, shared by all Runs; no independent mouse owners. */
export class WindowsComputerController implements ComputerControlPort {
  private socket: Socket | null = null;
  private server: Server | null = null;
  private process: ChildProcess | null = null;
  private elevated = false;
  private starting: Promise<ComputerUseStatus> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private rejectPending: ((error: Error) => void) | null = null;
  private generation = 0;
  private sessionAbort = new AbortController();
  private readonly catalog = new Map<string, ComputerApplication>();
  private readonly participants = new WeakMap<AbortSignal, number>();
  public constructor(private readonly configuration: { getConfiguration(): ComputerUseConfiguration }, private readonly permissions: Pick<ComputerApplicationPermissions, "describe" | "state" | "authorize" | "grants" | "clearSession"> | null = null) {}
  public getStatus(): ComputerUseStatus {
    return { supported: process.platform === "win32", running: this.socket !== null && !this.socket.destroyed, elevated: this.elevated };
  }
  public start(): Promise<ComputerUseStatus> {
    if (this.starting !== null) return this.starting;
    if (this.getStatus().running) return Promise.resolve(this.getStatus());
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }
  public stop(): void {
    this.generation++;
    const reject = this.rejectPending; this.rejectPending = null;
    reject?.(controlError("PROCESS_CANCELLED", "电脑控制已停止。"));
    this.sessionAbort.abort(); this.sessionAbort = new AbortController();
    this.permissions?.clearSession(); this.catalog.clear();
    this.socket?.destroy(); this.socket = null;
    this.server?.close(); this.server = null;
    const child = this.process; this.process = null; child?.kill();
    this.elevated = false;
  }
  public execute(input: ComputerUseArguments, signal: AbortSignal): Promise<ComputerResponse> {
    const command = computerUseArgumentsSchema.parse(input);
    const generation = this.generation;
    const result = this.queue.catch(() => undefined).then(async () => {
      signal.throwIfAborted();
      if (generation !== this.generation) throw controlError("PROCESS_CANCELLED", "电脑控制已停止；旧操作不会在重新启动后执行。");
      const configuration = this.configuration.getConfiguration();
      if (!configuration.enabled) return { ok: false as const, code: "COMPUTER_USE_DISABLED" };
      if (command.action === "status") return { ok: true as const, value: { ...this.getStatus() } };
      if (command.action === "stop") { this.participants.set(signal, this.generation); this.stop(); return { ok: true as const, value: { ...this.getStatus() } }; }
      const previous = this.participants.get(signal);
      if (previous !== undefined && previous !== this.generation) return { ok: false as const, code: "COMPUTER_CONTROL_STOPPED" };
      if (command.action === "start") {
        if (this.getStatus().running && configuration.administrator !== this.elevated) return { ok: false as const, code: "COMPUTER_PERMISSION_CHANGED" };
        this.participants.set(signal, this.generation);
        const abort = (): void => this.stop();
        signal.addEventListener("abort", abort, { once: true });
        try { const status = await this.start(); signal.throwIfAborted(); return { ok: true as const, value: { ...status } }; }
        finally { signal.removeEventListener("abort", abort); }
      }
      if (configuration.administrator && !this.getStatus().running) return { ok: false as const, code: "ADMINISTRATOR_START_REQUIRED" };
      if (!this.getStatus().running) return { ok: false as const, code: "COMPUTER_START_REQUIRED" };
      if (configuration.administrator !== this.elevated) return { ok: false as const, code: "COMPUTER_PERMISSION_CHANGED" };
      this.participants.set(signal, this.generation);
      if (command.action === "list") return this.list(configuration, signal);
      let application: ComputerApplication | undefined;
      let expectedExecutablePath: string | undefined;
      if (command.action === "launch") application = configuration.applications.find((value) => value.id === command.applicationId) ?? this.catalog.get(command.applicationId);
      else {
        const identity = await this.request({ action: "identify", windowId: command.windowId }, configuration, signal);
        if (!identity.ok) return identity;
        const executablePath = z.object({ executablePath: computerApplicationSchema.shape.executablePath }).strict().parse(identity.value).executablePath;
        expectedExecutablePath = executablePath;
        application = this.describe(executablePath);
      }
      if (application === undefined) return { ok: false as const, code: "APPLICATION_NOT_ALLOWED" };
      const access = this.access(application, this.configuration.getConfiguration());
      if (access === "blocked") return { ok: false as const, code: "APPLICATION_BLOCKED" };
      if (access !== "allowed" && !(await this.permissions?.authorize(application, AbortSignal.any([signal, this.sessionAbort.signal])))) return { ok: false as const, code: "APPLICATION_ACCESS_DENIED" };
      signal.throwIfAborted();
      if (generation !== this.generation) throw controlError("PROCESS_CANCELLED", "电脑控制已停止。");
      this.catalog.set(application.id, { ...application, enabled: true });
      return this.request(command, this.configuration.getConfiguration(), signal, expectedExecutablePath);
    });
    this.queue = result;
    return result;
  }
  private describe(executablePath: string): ComputerApplication {
    const resolved = this.permissions?.describe(executablePath) ?? computerApplicationSchema.parse({ id: randomUUID(), name: path.win32.basename(executablePath, ".exe"), executablePath, enabled: true });
    const existing = [...this.configuration.getConfiguration().applications, ...this.catalog.values()].find((value) => value.executablePath.toLowerCase() === resolved.executablePath.toLowerCase());
    const application = existing === undefined ? resolved : { ...existing, enabled: true };
    this.catalog.set(application.id, application); return application;
  }
  private access(application: ComputerApplication, configuration: ComputerUseConfiguration): "allowed" | "blocked" | "ask" {
    if (this.permissions !== null) return this.permissions.state(application);
    const matches = (value: ComputerApplication): boolean => value.enabled && value.executablePath.toLowerCase() === application.executablePath.toLowerCase();
    return configuration.blockedApplications.some(matches) ? "blocked" : configuration.accessMode === "all" || configuration.applications.some(matches) ? "allowed" : "ask";
  }
  private async list(configuration: ComputerUseConfiguration, signal: AbortSignal): Promise<ComputerResponse> {
    const response = await this.request({ action: "list" }, configuration, signal);
    if (!response.ok) return response;
    const metadata = z.object({ windows: z.array(windowMetadataSchema).max(1000) }).strict().parse(response.value);
    const windows = [];
    for (const window of metadata.windows) {
      let application: ComputerApplication;
      try { application = this.describe(window.executablePath); } catch (error) {
        if (error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM"].includes(String(error.code))) continue;
        throw error;
      }
      const access = this.access(application, this.configuration.getConfiguration());
      if (access === "blocked") continue;
      windows.push({ windowId: window.windowId, applicationId: application.id, name: application.name, title: access === "allowed" ? window.title : "", authorized: access === "allowed" });
    }
    for (const application of configuration.applications) this.catalog.set(application.id, application);
    const applications = [...this.catalog.values()].filter((value) => this.access(value, this.configuration.getConfiguration()) !== "blocked")
      .map((value) => ({ id: value.id, name: value.name, authorized: this.access(value, this.configuration.getConfiguration()) === "allowed" }));
    return { ok: true, value: { windows, applications } };
  }
  private async launch(): Promise<ComputerUseStatus> {
    const generation = this.generation;
    if (process.platform !== "win32") throw controlError("CAPABILITY_UNAVAILABLE", "电脑控制目前支持 Windows。");
    const configuration = this.configuration.getConfiguration();
    if (!configuration.enabled) throw controlError("CONFLICT", "请先启用电脑控制。");
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-"));
    const script = path.join(directory, "driver.ps1");
    await writeFile(script, `\uFEFF${driverSource}`, { encoding: "utf8", mode: 0o600 });
    const pipeName = `aster-computer-${randomUUID()}`;
    const token = randomBytes(32).toString("hex");
    const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
      if (generation !== this.generation || !this.configuration.getConfiguration().enabled) throw controlError("PROCESS_CANCELLED", "电脑控制启动已取消。");
      await new Promise<void>((resolve, reject) => {
        const server = createServer(); this.server = server;
        const timeout = setTimeout(() => fail(controlError("PROCESS_TIMEOUT", "控制进程启动超时；如出现 UAC，请确认是否已允许。")), 120_000);
        const fail = (error: Error): void => {
          clearTimeout(timeout);
          if (this.rejectPending === fail) this.rejectPending = null;
          if (generation === this.generation) this.stop();
          reject(error);
        };
        this.rejectPending = fail;
        server.on("error", fail);
        server.on("connection", (socket) => {
          if (this.socket !== null || generation !== this.generation) { socket.destroy(); return; }
          let buffer = "";
          socket.setEncoding("utf8");
          socket.setTimeout(5000, () => socket.destroy());
          const receive = (chunk: string): void => {
            if (generation !== this.generation) { socket.destroy(); return; }
            buffer += chunk;
            if (buffer.length > 2048) { socket.destroy(); return; }
            if (!buffer.includes("\n")) return;
            let value: unknown; try { value = JSON.parse(buffer.trim()); } catch { socket.destroy(); return; }
            const ready = readySchema.safeParse(value);
            if (!ready.success || !timingSafeEqual(Buffer.from(ready.data.token), Buffer.from(token))) { socket.destroy(); return; }
            if (ready.data.elevated !== configuration.administrator) { socket.destroy(); fail(controlError("PERMISSION_DENIED", "控制进程权限与配置不符；请检查管理员模式。")); return; }
            socket.off("data", receive); clearTimeout(timeout); this.rejectPending = null;
            socket.setTimeout(0);
            this.socket = socket; this.elevated = ready.data.elevated;
            socket.on("error", () => { if (this.socket === socket) this.stop(); });
            socket.on("close", () => { if (this.socket === socket) this.stop(); });
            server.close(); this.server = null;
            resolve();
          };
          socket.on("data", receive); socket.on("error", () => socket.destroy());
        });
        server.listen(`\\\\.\\pipe\\${pipeName}`, () => {
          const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-PipeName", pipeName, "-Token", token];
          if (configuration.administrator) {
            const quotedArgs = args.map((value) => psQuote(`"${value}"`)).join(",");
            const launcher = `Start-Process -FilePath ${psQuote(executable)} -ArgumentList @(${quotedArgs}) -Verb RunAs -WindowStyle Hidden -ErrorAction Stop | Out-Null`;
            this.process = spawn(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(launcher, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" });
            this.process.once("exit", (code) => { if (code !== 0 && this.socket === null) fail(controlError("PERMISSION_DENIED", "管理员启动被取消或失败，请在设置中重试。")); });
          } else {
            this.process = spawn(executable, args, { windowsHide: true, stdio: "ignore" });
            const child = this.process;
            child.once("exit", () => { if (this.process !== child) return; if (this.socket === null) fail(controlError("PROCESS_FAILED", "电脑控制进程未能启动。")); else this.stop(); });
          }
          this.process.once("error", fail);
        });
      });
      return this.getStatus();
    } finally {
      // PowerShell loads the source before connecting; no script file is needed by a running helper.
      await rm(directory, { recursive: true, force: true });
    }
  }
  private request(command: ComputerUseArguments | { action: "identify"; windowId: string }, configuration: ComputerUseConfiguration, signal: AbortSignal, expectedExecutablePath?: string): Promise<ComputerResponse> {
    return new Promise((resolve, reject) => {
      if (!configuration.enabled) { resolve({ ok: false, code: "COMPUTER_USE_DISABLED" }); return; }
      if (configuration.administrator !== this.elevated) { resolve({ ok: false, code: "COMPUTER_PERMISSION_CHANGED" }); return; }
      const socket = this.socket;
      if (socket === null) { reject(controlError("CONFLICT", "电脑控制未启动。")); return; }
      const id = randomUUID(); let buffer = "";
      const cleanup = (): void => { clearTimeout(timeout); signal.removeEventListener("abort", abort); socket.off("data", receive); this.rejectPending = null; };
      const fail = (error: Error): void => { cleanup(); reject(error); };
      const abort = (): void => { fail(controlError("PROCESS_CANCELLED", "电脑操作已取消；不会自动重放。")); this.stop(); };
      const timeout = setTimeout(() => { fail(controlError("PROCESS_TIMEOUT", "电脑操作超时；控制进程已断开，不会自动重放。")); this.stop(); }, 25_000);
      const receive = (chunk: string): void => {
        buffer += chunk;
        if (buffer.length > 24 * 1024 * 1024) { fail(new Error("电脑控制结果超过上限。")); this.stop(); return; }
        if (!buffer.includes("\n")) return;
        try {
          const parsed = responseSchema.parse(JSON.parse(buffer.trim()));
          if (parsed.id !== id) throw new Error("电脑控制响应不匹配。");
          cleanup(); resolve(parsed);
        } catch (error) { fail(error instanceof Error ? error : new Error("电脑控制响应无效。")); this.stop(); }
      };
      this.rejectPending = fail;
      socket.on("data", receive); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      const applications = [...(this.permissions?.grants() ?? configuration.applications), ...[...this.catalog.values()].filter((value) => this.access(value, configuration) === "allowed").map((value) => ({ ...value, enabled: true }))];
      socket.write(`${JSON.stringify({ id, command, applications, accessMode: configuration.accessMode, blockedApplications: configuration.blockedApplications, ...(expectedExecutablePath === undefined ? {} : { expectedExecutablePath }) })}\n`);
    });
  }
}
