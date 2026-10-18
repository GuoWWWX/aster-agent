import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { computerUseArgumentsSchema, type AgentErrorCode, type ComputerUseArguments, type ComputerUseConfiguration, type ComputerUseStatus } from "@agent/protocol";
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
  public constructor(private readonly configuration: { getConfiguration(): ComputerUseConfiguration }) {}
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
    this.socket?.destroy(); this.socket = null;
    this.server?.close(); this.server = null;
    const child = this.process; this.process = null; child?.kill();
    this.elevated = false;
  }
  public execute(input: ComputerUseArguments, signal: AbortSignal): Promise<ComputerResponse> {
    const command = computerUseArgumentsSchema.parse(input);
    const generation = this.generation;
    const result = this.queue.catch(() => undefined).then(() => {
      signal.throwIfAborted();
      if (generation !== this.generation) throw controlError("PROCESS_CANCELLED", "电脑控制已停止；旧操作不会在重新启动后执行。");
      const configuration = this.configuration.getConfiguration();
      if (!configuration.enabled) return { ok: false as const, code: "COMPUTER_USE_DISABLED" };
      if (configuration.administrator && !this.getStatus().running) return { ok: false as const, code: "ADMINISTRATOR_START_REQUIRED" };
      if (!this.getStatus().running) return { ok: false as const, code: "COMPUTER_START_REQUIRED" };
      if (configuration.administrator !== this.elevated) return { ok: false as const, code: "COMPUTER_PERMISSION_CHANGED" };
      return this.request(command, configuration, signal);
    });
    this.queue = result;
    return result;
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
  private request(command: ComputerUseArguments, configuration: ComputerUseConfiguration, signal: AbortSignal): Promise<ComputerResponse> {
    return new Promise((resolve, reject) => {
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
      socket.write(`${JSON.stringify({ id, command, applications: configuration.applications })}\n`);
    });
  }
}
