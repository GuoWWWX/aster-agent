import { randomUUID } from "node:crypto";

import { spawn as spawnPty } from "node-pty";

import {
  terminalSessionEventSchema,
  terminalSessionSchema,
  type TerminalConfiguration,
  type TerminalSession,
  type TerminalSessionEvent,
  type TerminalSessionOpenInput,
  type TerminalSessionOutput,
  type TerminalSessionOutputInput,
  type TerminalSessionReferenceInput,
  type TerminalSessionResizeInput,
  type TerminalSessionWriteInput,
  type TerminalShell,
} from "@agent/protocol";

import { ProjectRegistry } from "../projects/project-registry.js";
import { TerminalConfigurationStore } from "../settings/terminal-configuration-store.js";
import { commandEnvironmentWithBundledRipgrep } from "./project-tool-registry.js";
import { resolveTerminalExecutable } from "./terminal-executable-resolver.js";

type Disposable = { dispose(): void };

type PtyProcess = {
  kill(): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number }) => void): Disposable;
  resize(columns: number, rows: number): void;
  write(data: string): void;
};

type PtyFactory = (
  executable: string,
  args: readonly string[],
  options: {
    cols: number;
    cwd: string;
    env: Record<string, string>;
    name: string;
    rows: number;
  },
) => PtyProcess;

type ActiveTerminalSession = {
  dataSubscription: Disposable;
  exitSubscription: Disposable;
  output: string;
  outputEndCursor: number;
  outputStartCursor: number;
  process: PtyProcess;
  projectId: string;
};

type TerminalEventListener = (event: TerminalSessionEvent) => void;

const MAX_TERMINAL_EVENT_CHARS = 65_536;
const MAX_TERMINAL_TRANSCRIPT_CHARS = 512_000;

export type TerminalSessionPort = {
  close(input: TerminalSessionReferenceInput): void;
  open(input: TerminalSessionOpenInput): TerminalSession;
  readOutput(input: TerminalSessionOutputInput): TerminalSessionOutput;
  write(input: TerminalSessionWriteInput): void;
};

class TerminalLaunchError extends Error {
  public readonly code = "TERMINAL_LAUNCH_FAILED";

  public constructor(label: string) {
    super(`无法启动${label}。请检查设置中的终端启动路径和项目目录。`);
    this.name = "TerminalLaunchError";
  }
}

export class TerminalSessionController {
  private readonly listeners = new Set<TerminalEventListener>();
  private readonly pendingData = new Map<string, string[]>();
  private readonly scheduledDataFlushes = new Set<string>();
  private readonly sessions = new Map<string, ActiveTerminalSession>();

  public constructor(
    private readonly projects: Pick<ProjectRegistry, "getProject">,
    private readonly terminalConfiguration: Pick<TerminalConfigurationStore, "getConfiguration">,
    private readonly createPty: PtyFactory = defaultPtyFactory,
  ) {}

  public open(input: TerminalSessionOpenInput): TerminalSession {
    const project = this.projects.getProject(input.projectId);
    const launch = resolveInteractiveShell(this.terminalConfiguration.getConfiguration());
    const sessionId = randomUUID();
    let process: PtyProcess;
    try {
      process = this.createPty(launch.executable, launch.args, {
        cols: input.columns,
        cwd: project.rootPath,
        env: interactiveTerminalEnvironment(
          commandEnvironmentWithBundledRipgrep(globalThis.process.env),
        ),
        name: "xterm-256color",
        rows: input.rows,
      });
    } catch {
      throw new TerminalLaunchError(launch.label);
    }
    const dataSubscription = process.onData((data) => {
      this.queueData(sessionId, data);
    });
    const exitSubscription = process.onExit(({ exitCode }) => {
      this.flushData(sessionId);
      this.disposeSession(sessionId, false);
      this.emit({ exitCode, sessionId, type: "exit" });
    });
    this.sessions.set(sessionId, {
      dataSubscription,
      exitSubscription,
      output: "",
      outputEndCursor: 0,
      outputStartCursor: 0,
      process,
      projectId: input.projectId,
    });
    return terminalSessionSchema.parse({
      projectId: input.projectId,
      sessionId,
      shellLabel: launch.label,
    });
  }

  public write(input: TerminalSessionWriteInput): void {
    this.requireSession(input.sessionId).process.write(input.data);
  }

  public readOutput(input: TerminalSessionOutputInput): TerminalSessionOutput {
    const session = this.requireSession(input.sessionId);
    const requestedCursor = input.afterCursor;
    const startCursor = Math.min(
      session.outputEndCursor,
      Math.max(requestedCursor, session.outputStartCursor),
    );
    const startOffset = startCursor - session.outputStartCursor;
    const remaining = session.output.slice(startOffset);
    const data = remaining.slice(0, input.maxChars);
    const nextCursor = startCursor + data.length;
    return {
      data,
      nextCursor,
      truncated: requestedCursor < session.outputStartCursor || nextCursor < session.outputEndCursor,
    };
  }

  public resize(input: TerminalSessionResizeInput): void {
    this.requireSession(input.sessionId).process.resize(input.columns, input.rows);
  }

  public close(input: TerminalSessionReferenceInput): void {
    this.disposeSession(input.sessionId, true);
  }

  public onEvent(listener: TerminalEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.listeners.clear();
    for (const sessionId of [...this.sessions.keys()]) this.disposeSession(sessionId, true);
  }

  private requireSession(sessionId: string): ActiveTerminalSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error("终端会话不存在或已经结束。");
    return session;
  }

  private disposeSession(sessionId: string, kill: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.sessions.delete(sessionId);
    this.pendingData.delete(sessionId);
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    if (kill) session.process.kill();
  }

  private queueData(sessionId: string, data: string): void {
    this.appendTranscript(sessionId, data);
    const pending = this.pendingData.get(sessionId);
    if (pending === undefined) this.pendingData.set(sessionId, [data]);
    else pending.push(data);
    if (this.scheduledDataFlushes.has(sessionId)) return;
    this.scheduledDataFlushes.add(sessionId);
    // node-pty often splits one visual update into several callbacks; keep one IPC event per turn.
    setImmediate(() => this.flushData(sessionId));
  }

  private flushData(sessionId: string): void {
    this.scheduledDataFlushes.delete(sessionId);
    const pending = this.pendingData.get(sessionId);
    this.pendingData.delete(sessionId);
    if (pending === undefined) return;

    let data = "";
    for (const chunk of pending) {
      let offset = 0;
      while (offset < chunk.length) {
        const size = Math.min(MAX_TERMINAL_EVENT_CHARS - data.length, chunk.length - offset);
        data += chunk.slice(offset, offset + size);
        offset += size;
        if (data.length === MAX_TERMINAL_EVENT_CHARS) {
          this.emit({ data, sessionId, type: "data" });
          data = "";
        }
      }
    }
    if (data.length > 0) this.emit({ data, sessionId, type: "data" });
  }

  private emit(event: TerminalSessionEvent): void {
    const parsed = terminalSessionEventSchema.parse(event);
    for (const listener of this.listeners) listener(parsed);
  }

  private appendTranscript(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined || data.length === 0) return;
    session.output += data;
    session.outputEndCursor += data.length;
    if (session.output.length <= MAX_TERMINAL_TRANSCRIPT_CHARS) return;
    const removed = session.output.length - MAX_TERMINAL_TRANSCRIPT_CHARS;
    session.output = session.output.slice(removed);
    session.outputStartCursor += removed;
  }
}

function resolveInteractiveShell(configuration: TerminalConfiguration): {
  args: readonly string[];
  executable: string;
  label: string;
} {
  const shell = resolveShell(configuration.shell);
  switch (shell) {
    case "powershell":
      return {
        args: ["-NoLogo"],
        executable: resolveTerminalExecutable(configuration, shell, "powershell.exe"),
        label: "Windows PowerShell",
      };
    case "pwsh":
      return {
        args: ["-NoLogo"],
        executable: resolveTerminalExecutable(configuration, shell, "pwsh.exe"),
        label: "PWSH（PowerShell 7）",
      };
    case "cmd":
      if (process.platform !== "win32") throw new Error("命令提示符仅在 Windows 上可用。");
      return {
        args: ["/d"],
        executable: resolveTerminalExecutable(configuration, shell, "cmd.exe"),
        label: "命令提示符",
      };
    case "bash":
      if (process.platform === "win32") throw new Error("Windows 上暂不支持直接以 Bash 打开终端。");
      return {
        args: ["--noprofile", "--norc"],
        executable: resolveTerminalExecutable(configuration, shell, "bash"),
        label: "Bash",
      };
  }
}

function resolveShell(shell: TerminalShell): Exclude<TerminalShell, "system"> {
  if (shell !== "system") return shell;
  return process.platform === "win32" ? "powershell" : "pwsh";
}

function interactiveTerminalEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const resolved = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete resolved.NO_COLOR;
  return {
    ...resolved,
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
  };
}

const defaultPtyFactory: PtyFactory = (executable, args, options) =>
  spawnPty(executable, [...args], options);
