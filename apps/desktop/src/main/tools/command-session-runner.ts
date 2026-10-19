import { spawn } from "node:child_process";
import path from "node:path";
import { TextDecoder, stripVTControlCharacters } from "node:util";
import { backgroundCommandSchema, DEFAULT_TERMINAL_CONFIGURATION, type BackgroundCommand, type BackgroundCommandOutput, type TerminalConfiguration, type TerminalOutputEncoding, type TerminalShell } from "@agent/protocol";
import { sanitizeSensitiveText } from "../errors/agent-error.js";
import { rgPath } from "./bundled-ripgrep.js";
import { resolveTerminalExecutable } from "./terminal-executable-resolver.js";
import { terminateProcessTree } from "./terminate-process-tree.js";
import type { ToolExecutionResult } from "./tool-execution-result.js";

const MAX_COMMAND_OUTPUT_LENGTH = 200_000;
const MAX_SERVICE_NAME_LENGTH = 120;

export type TerminalConfigurationProvider = {
  getConfiguration(): TerminalConfiguration;
};

type ResolvedTerminalShell = Exclude<TerminalShell, "system">;

type TerminalLaunch = {
  args: string[];
  displayName: string;
  executable: string;
  shell: ResolvedTerminalShell;
};

export type PreparedCommand = {
  command: string;
  description?: string | undefined;
  mode: "batch" | "service";
  parallel: boolean;
  serviceName?: string | undefined;
  timeoutMs: number | null;
  yieldTimeMs: number;
};

type CommandSessionStatus = "running" | "completed" | "failed" | "cancelled";

export type CommandOutputEvent = {
  startedAt: string;
  completedAt: string | null;
  commandId: string;
  delta: string;
  done: boolean;
  exitCode: number | null;
  status: CommandSessionStatus;
  stream: "stderr" | "stdout";
  timedOut: boolean;
  truncated: boolean;
};

export type CommandOutputListener = (event: CommandOutputEvent) => void;

type CommandSession = {
  command: string;
  commandId: string;
  completedAt: string | null;
  completion: Promise<void>;
  error: string | null;
  exitCode: number | null;
  conversationId: string;
  mode: "batch" | "service";
  projectId: string | undefined;
  outputEncoding: TerminalOutputEncoding;
  serviceName: string;
  startedAt: string;
  status: CommandSessionStatus;
  stderrChunks: Buffer[];
  stderrByteLength: number;
  stdoutChunks: Buffer[];
  stdoutByteLength: number;
  terminal: TerminalLaunch;
  terminate: (cancelled: boolean) => void;
  termination: Promise<void> | null;
  timeoutMs: number | null;
  timedOut: boolean;
  truncated: boolean;
  workingDirectory: string;
};

export const DEFAULT_TERMINAL_CONFIGURATION_PROVIDER: TerminalConfigurationProvider = {
  getConfiguration: () => structuredClone(DEFAULT_TERMINAL_CONFIGURATION),
};

export type PreparedCommandLaunch = {
  outputEncoding: TerminalOutputEncoding;
  terminal: TerminalLaunch;
};

type ReadCommandOutputOptions = {
  commandId: string;
  stdoutOffset: number;
  stderrOffset: number;
  maxChars: number;
  yieldTimeMs: number;
};

type WaitForCommandsOptions = {
  commandIds: string[];
  timeoutMs: number;
  waitFor: "any" | "all";
};

/** Owns command processes and their in-memory output until application disposal. */
export class CommandSessionRunner {
  private readonly commandSessions = new Map<string, CommandSession>();

  public constructor(
    private readonly terminalConfiguration: TerminalConfigurationProvider = DEFAULT_TERMINAL_CONFIGURATION_PROVIDER,
  ) {}

  public prepareLaunch(command: string): PreparedCommandLaunch {
    const configuration = this.getCommandConfiguration();
    return { outputEncoding: configuration.outputEncoding, terminal: this.createTerminalLaunch(configuration, command) };
  }

  public async observe(commandId: string, yieldTimeMs: number, signal: AbortSignal): Promise<ToolExecutionResult> {
    const session = this.commandSessions.get(commandId);
    if (session === undefined) throw new Error("Command session is no longer available.");
    if (yieldTimeMs > 0 && session.status === "running") {
      await waitForBoundedCompletion(session.completion, yieldTimeMs, signal);
    }
    const result = this.commandExecutionResult(session);
    return session.status === "running"
      ? { ...result, commandCompletion: session.completion.then(() => this.commandExecutionResult(session)) }
      : result;
  }

  public getEnvironmentDescription(): string {
    const configuration = this.getCommandConfiguration();
    const terminal = this.createTerminalLaunch(configuration, "");
    return `${terminal.displayName} (output decoding: ${terminalOutputEncodingLabel(
      configuration.outputEncoding,
    )})`;
  }

  private createTerminalLaunch(
    configuration: TerminalConfiguration,
    command: string,
  ): TerminalLaunch {
    const shell = this.resolveTerminalShell(configuration.shell);

    switch (shell) {
      case "powershell":
        return {
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            powershellUtf8Command(command),
          ],
          displayName: process.platform === "win32" ? "Windows PowerShell" : "PowerShell",
          executable: resolveTerminalExecutable(
            configuration,
            shell,
            process.platform === "win32" ? "powershell.exe" : "pwsh",
          ),
          shell,
        };
      case "pwsh":
        return {
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            powershellUtf8Command(command),
          ],
          displayName: "PWSH（PowerShell 7）",
          executable: resolveTerminalExecutable(
            configuration,
            shell,
            process.platform === "win32" ? "pwsh.exe" : "pwsh",
          ),
          shell,
        };
      case "cmd":
        if (process.platform !== "win32") {
          throw new Error("命令提示符仅在 Windows 上可用。");
        }
        return {
          args: ["/d", "/s", "/c", command],
          displayName: "命令提示符",
          executable: resolveTerminalExecutable(configuration, shell, "cmd.exe"),
          shell,
        };
      case "bash":
        if (process.platform === "win32") {
          throw new Error("Windows 上暂不支持直接以 Bash 运行项目命令。");
        }
        return {
          args: ["--noprofile", "--norc", "-lc", command],
          displayName: "Bash",
          executable: resolveTerminalExecutable(configuration, shell, "bash"),
          shell,
        };
    }
  }

  private getCommandConfiguration(): TerminalConfiguration {
    return {
      ...DEFAULT_TERMINAL_CONFIGURATION,
      outputEncoding: this.terminalConfiguration.getConfiguration().outputEncoding,
    };
  }

  private resolveTerminalShell(shell: TerminalShell): ResolvedTerminalShell {
    if (shell !== "system") return shell;
    return process.platform === "win32" ? "powershell" : "pwsh";
  }

  public start(input: {
    commandId: string;
    command: PreparedCommand;
    projectId: string | undefined;
    conversationId: string;
    workingDirectory: string;
    signal: AbortSignal;
    launch: PreparedCommandLaunch;
    onOutput?: CommandOutputListener | undefined;
  }): Promise<void> {
    const { commandId, command, projectId, conversationId, workingDirectory, signal, onOutput } = input;
    const { outputEncoding, terminal } = input.launch;
    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const child = spawn(
      terminal.executable,
      terminal.args,
      {
        cwd: workingDirectory,
        detached: process.platform !== "win32",
        env: commandEnvironmentWithBundledRipgrep(process.env, terminal.shell),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const session: CommandSession = {
      command: command.command,
      commandId,
      completedAt: null,
      completion,
      conversationId,
      error: null,
      exitCode: null,
      mode: command.mode,
      outputEncoding,
      projectId,
      serviceName: command.serviceName ?? this.defaultServiceName(command.command),
      startedAt: new Date().toISOString(),
      status: "running",
      stderrByteLength: 0,
      stderrChunks: [],
      stdoutByteLength: 0,
      stdoutChunks: [],
      terminal,
      terminate: (cancelled) => {
        if (session.status !== "running" || child.pid === undefined || session.termination !== null) return;
        if (cancelled) session.status = "cancelled";
        session.termination = terminateProcessTree(child.pid);
        // Still close the Shell handle on a failed tree stop; disposal awaits the
        // original promise so an incomplete cleanup remains visible to its owner.
        void session.termination.catch(() => child.kill());
      },
      termination: null,
      timeoutMs: command.timeoutMs,
      timedOut: false,
      truncated: false,
      workingDirectory,
    };
    const decoders = {
      stderr: new StreamingTerminalOutputDecoder(outputEncoding),
      stdout: new StreamingTerminalOutputDecoder(outputEncoding),
    } satisfies Record<"stderr" | "stdout", StreamingTerminalOutputDecoder>;
    let outputFinished = false;
    let outputStarted = false;
    const emitOutput = (
      stream: "stderr" | "stdout",
      delta: string,
      done: boolean,
      status: CommandSessionStatus,
    ): void => {
      if (onOutput === undefined || (!done && delta.length === 0 && outputStarted)) return;
      outputStarted = true;
      // Output is best-effort and must never interrupt the child process.
      try {
        onOutput({
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          commandId,
          delta,
          done,
          exitCode: session.exitCode,
          status,
          stream,
          timedOut: session.timedOut,
          truncated: session.truncated,
        });
      } catch {
        // The owning run will still receive the final command snapshot.
      }
    };
    const appendOutput = (target: "stderr" | "stdout", chunk: Buffer): void => {
      const byteLengthKey = target === "stderr" ? "stderrByteLength" : "stdoutByteLength";
      const chunks = target === "stderr" ? session.stderrChunks : session.stdoutChunks;
      const remaining = MAX_COMMAND_OUTPUT_LENGTH - session[byteLengthKey];
      if (remaining <= 0) {
        session.truncated = true;
        return;
      }
      const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(accepted);
      session[byteLengthKey] += accepted.length;
      if (accepted.length < chunk.length) session.truncated = true;
      emitOutput(target, decoders[target].push(accepted), false, session.status);
    };
    const flushOutput = (): void => {
      if (outputFinished) return;
      outputFinished = true;
      for (const stream of ["stdout", "stderr"] as const) {
        emitOutput(stream, decoders[stream].flush(), true, session.status);
      }
    };
    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (
      status: Exclude<CommandSessionStatus, "running">,
      exitCode: number | null,
      error: string | null,
    ): void => {
      if (session.completedAt !== null) return;
      cleanup();
      session.completedAt = new Date().toISOString();
      session.error = error;
      session.exitCode = exitCode;
      session.status = session.status === "cancelled" ? "cancelled" : status;
      flushOutput();
      resolveCompletion();
    };
    const onAbort = (): void => session.terminate(true);

    const timer = command.timeoutMs === null
      ? null
      : setTimeout(() => {
          session.timedOut = true;
          session.terminate(false);
        }, command.timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.once("error", (error) => {
      finish("failed", null, `无法启动 ${terminal.displayName}：${error.message}`);
    });
    child.once("close", (exitCode) => {
      finish(
        exitCode === 0 && !session.timedOut ? "completed" : "failed",
        exitCode,
        null,
      );
    });
    if (signal.aborted) session.terminate(true);
    emitOutput("stdout", "", false, session.status);
    this.commandSessions.set(commandId, session);
    return completion;
  }

  private commandExecutionResult(session: CommandSession): ToolExecutionResult {
    const value = this.commandSessionSnapshot(session);
    if (session.status === "running" || session.status === "completed") {
      return this.success(value);
    }
    return {
      content: JSON.stringify({ ok: false, value }),
      isError: true,
      kind: "completed",
    };
  }

  public defaultServiceName(command: string): string {
    const firstLine = command.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "Background command";
    return firstLine.length <= MAX_SERVICE_NAME_LENGTH
      ? firstLine
      : `${firstLine.slice(0, MAX_SERVICE_NAME_LENGTH - 3)}...`;
  }

  public listConversationCommands(conversationIds: readonly string[]): BackgroundCommand[] {
    const owners = new Set(conversationIds);
    return [...this.commandSessions.values()].filter((session) => owners.has(session.conversationId))
      .sort((left, right) => Number(right.status === "running") - Number(left.status === "running") || right.startedAt.localeCompare(left.startedAt)).slice(0, 50).map((session) => this.backgroundCommandSummary(session));
  }

  public async stopConversationCommand(commandId: string, conversationIds: readonly string[]): Promise<BackgroundCommand> {
    const session = this.commandSessions.get(commandId);
    if (session === undefined || !conversationIds.includes(session.conversationId)) throw new Error("找不到当前对话的后台程序。");
    if (session.status === "running") { session.terminate(true); await session.completion; }
    return this.backgroundCommandSummary(session);
  }

  public readConversationCommand(commandId: string, conversationIds: readonly string[], maxChars = 24000): BackgroundCommandOutput {
    const session = this.commandSessions.get(commandId);
    if (session === undefined || !conversationIds.includes(session.conversationId)) throw new Error("找不到当前对话的后台程序。");
    const stdout = stripVTControlCharacters(sanitizeSensitiveText(decodeTerminalOutput(Buffer.concat(session.stdoutChunks), session.outputEncoding)));
    const stderr = stripVTControlCharacters(sanitizeSensitiveText(decodeTerminalOutput(Buffer.concat(session.stderrChunks), session.outputEncoding)));
    return { command: this.backgroundCommandSummary(session), stdout: stdout.slice(-maxChars), stderr: stderr.slice(-maxChars),
      error: session.error === null ? null : sanitizeSensitiveText(session.error), timedOut: session.timedOut,
      truncated: session.truncated || stdout.length > maxChars || stderr.length > maxChars };
  }

  private backgroundCommandSummary(session: CommandSession): BackgroundCommand {
    return backgroundCommandSchema.parse({ commandId: session.commandId, conversationId: session.conversationId,
      command: sanitizeSensitiveText(session.command).slice(0, 4000), mode: session.mode, serviceName: sanitizeSensitiveText(session.serviceName).slice(0, 120) || null,
      workingDirectory: session.workingDirectory, startedAt: session.startedAt, completedAt: session.completedAt,
      status: session.status, exitCode: session.exitCode });
  }

  public listBackgroundCommands(
    projectId: string | undefined,
    conversationId: string,
  ): unknown[] {
    return [...this.commandSessions.values()]
      .filter((session) => session.status === "running"
        && session.projectId === projectId
        && session.conversationId === conversationId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((session) => ({
        command: session.command,
        commandId: session.commandId,
        mode: session.mode,
        serviceName: session.serviceName,
        startedAt: session.startedAt,
        status: session.status,
        terminal: {
          displayName: session.terminal.displayName,
          shell: session.terminal.shell,
        },
        timeoutMs: session.timeoutMs,
        workingDirectory: session.workingDirectory,
      }));
  }

  private commandSessionSnapshot(session: CommandSession): unknown {
    const stdout = decodeTerminalOutput(Buffer.concat(session.stdoutChunks), session.outputEncoding);
    const stderr = decodeTerminalOutput(Buffer.concat(session.stderrChunks), session.outputEncoding);
    return {
      command: session.command,
      commandId: session.commandId,
      completedAt: session.completedAt,
      error: session.error,
      exitCode: session.exitCode,
      mode: session.mode,
      nextStdoutOffset: stdout.length,
      nextStderrOffset: stderr.length,
      serviceName: session.serviceName,
      startedAt: session.startedAt,
      status: session.status,
      stderr,
      stdout,
      terminal: {
        displayName: session.terminal.displayName,
        outputEncoding: session.outputEncoding,
        shell: session.terminal.shell,
      },
      timeoutMs: session.timeoutMs,
      timedOut: session.timedOut,
      truncated: session.truncated,
      workingDirectory: session.workingDirectory,
    };
  }

  public async readCommandOutput(
    input: ReadCommandOutputOptions,
    projectId: string | undefined,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const session = this.commandSessions.get(input.commandId);
    if (session === undefined || session.projectId !== projectId || session.conversationId !== conversationId) {
      throw new Error("Command session was not found in this conversation.");
    }
    if (session.status === "running" && input.yieldTimeMs > 0) {
      await waitForBoundedCompletion(session.completion, input.yieldTimeMs, signal);
    }
    throwIfAborted(signal);
    const stdout = decodeTerminalOutput(Buffer.concat(session.stdoutChunks), session.outputEncoding);
    const stderr = decodeTerminalOutput(Buffer.concat(session.stderrChunks), session.outputEncoding);
    const stdoutStart = Math.min(input.stdoutOffset, stdout.length);
    const stderrStart = Math.min(input.stderrOffset, stderr.length);
    const nextStdoutOffset = Math.min(stdoutStart + input.maxChars, stdout.length);
    const nextStderrOffset = Math.min(stderrStart + input.maxChars, stderr.length);
    return this.success({
      commandId: session.commandId,
      completedAt: session.completedAt,
      error: session.error,
      exitCode: session.exitCode,
      hasMoreOutput: nextStdoutOffset < stdout.length || nextStderrOffset < stderr.length,
      mode: session.mode,
      nextStdoutOffset,
      nextStderrOffset,
      startedAt: session.startedAt,
      status: session.status,
      stdout: stdout.slice(stdoutStart, nextStdoutOffset),
      stderr: stderr.slice(stderrStart, nextStderrOffset),
      timedOut: session.timedOut,
      truncated: session.truncated,
    });
  }

  public async waitForCommands(
    input: WaitForCommandsOptions,
    projectId: string | undefined,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const commandIds = [...new Set(input.commandIds)];
    const sessions = commandIds.map((commandId) => {
      const session = this.commandSessions.get(commandId);
      if (session === undefined || !this.canAccessCommand(session, projectId, conversationId)) {
        throw new Error("Command was not found in the current command scope.");
      }
      return session;
    });
    const isReady = (): boolean => input.waitFor === "all"
      ? sessions.every((session) => session.completedAt !== null)
      : sessions.some((session) => session.completedAt !== null);
    const waitStatus = isReady()
      ? "finished"
      : await waitForBoundedCompletion(
          input.waitFor === "all"
            ? Promise.all(sessions.map((session) => session.completion)).then(() => undefined)
            : Promise.race(sessions.map((session) => session.completion)),
          input.timeoutMs,
          signal,
        );
    return this.success({
      commands: sessions.map((session) => this.commandSessionSnapshot(session)),
      waitStatus,
    });
  }

  public stopCommand(
    commandId: string,
    projectId: string | undefined,
    conversationId: string,
  ): ToolExecutionResult {
    const session = this.commandSessions.get(commandId);
    if (session === undefined || !this.canAccessCommand(session, projectId, conversationId)) {
      throw new Error("Command was not found in the current command scope.");
    }
    session.terminate(true);
    return this.success({ command: {
      commandId: session.commandId,
      status: session.status,
      completedAt: session.completedAt,
      exitCode: session.exitCode,
      error: session.error,
    } });
  }

  private canAccessCommand(
    session: CommandSession,
    projectId: string | undefined,
    conversationId: string,
  ): boolean {
    return projectId === undefined
      ? session.projectId === undefined && session.conversationId === conversationId
      : session.projectId === projectId;
  }

  public forgetCompleted(commandId: string): void {
    const session = this.commandSessions.get(commandId);
    if (session?.status !== "running") this.commandSessions.delete(commandId);
  }

  public async dispose(): Promise<void> {
    const sessions = [...this.commandSessions.values()];
    for (const session of sessions) {
      session.terminate(true);
    }
    const results = await Promise.allSettled(sessions.map(async (session) => {
      await session.completion;
      await session.termination;
    }));
    this.commandSessions.clear();
    const errors: unknown[] = [];
    for (const result of results) { if (result.status === "rejected") errors.push(result.reason); }
    if (errors.length > 0) throw new AggregateError(errors, "Command process cleanup failed.");
  }

  private success(value: unknown): ToolExecutionResult {
    return { kind: "completed", content: JSON.stringify({ ok: true, value }), isError: false };
  }
}

function powershellUtf8Command(command: string): string {
  const configureUtf8 = [
    "$__agentUtf8 = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::InputEncoding = $__agentUtf8",
    "[Console]::OutputEncoding = $__agentUtf8",
    "$OutputEncoding = $__agentUtf8",
  ].join("; ");
  return `${configureUtf8}; ${command}`;
}

export function commandEnvironmentWithBundledRipgrep(
  environment: NodeJS.ProcessEnv,
  shell?: TerminalShell,
): NodeJS.ProcessEnv {
  const nextEnvironment = { ...environment };
  if (process.platform === "win32" && shell === "powershell") {
    // Electron may inherit PS7's module path, whose Utility module cannot load
    // in Windows PowerShell. Prefer that shell's built-ins, preserving custom paths.
    const systemRootKey = Object.keys(environment).find((key) => key.toLowerCase() === "systemroot");
    const systemRoot = systemRootKey === undefined ? undefined : environment[systemRootKey];
    if (systemRoot !== undefined && systemRoot.length > 0) {
      const modulePathKey = Object.keys(nextEnvironment).find((key) => key.toLowerCase() === "psmodulepath") ?? "PSModulePath";
      const coreModules = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
      const inheritedModules = (nextEnvironment[modulePathKey] ?? "").split(path.delimiter)
        .filter((entry) => entry.length > 0 && entry.toLowerCase() !== coreModules.toLowerCase());
      nextEnvironment[modulePathKey] = [coreModules, ...inheritedModules].join(path.delimiter);
    }
  }
  const pathKey = Object.keys(nextEnvironment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = nextEnvironment[pathKey] ?? "";
  const ripgrepDirectory = path.dirname(rgPath);
  const pathEntries = currentPath.split(path.delimiter).filter((entry) => entry.length > 0);
  const alreadyAvailable = pathEntries.some((entry) =>
    process.platform === "win32"
      ? entry.toLowerCase() === ripgrepDirectory.toLowerCase()
      : entry === ripgrepDirectory
  );
  nextEnvironment[pathKey] = alreadyAvailable
    ? currentPath
    : [ripgrepDirectory, currentPath].filter((entry) => entry.length > 0).join(path.delimiter);
  return nextEnvironment;
}

function waitForBoundedCompletion(
  completion: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<"finished" | "timeout"> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    void completion.then(() => {
      cleanup();
      resolve("finished");
    });
  });
}

export function decodeTerminalOutput(
  output: Buffer,
  encoding: TerminalOutputEncoding,
): string {
  if (encoding !== "auto") {
    return new TextDecoder(encoding).decode(output);
  }

  let decoded = "";
  let lineStart = 0;

  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0x0a) continue;
    decoded += decodeAutoTerminalLine(output.subarray(lineStart, index + 1));
    lineStart = index + 1;
  }

  return `${decoded}${decodeAutoTerminalLine(output.subarray(lineStart))}`;
}

function decodeAutoTerminalLine(output: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return new TextDecoder("gb18030").decode(output);
  }
}

function terminalOutputEncodingLabel(encoding: TerminalOutputEncoding): string {
  switch (encoding) {
    case "auto":
      return "auto (UTF-8/GB18030)";
    case "utf-8":
      return "UTF-8";
    case "gbk":
      return "GBK";
    case "gb18030":
      return "GB18030";
    case "utf-16le":
      return "UTF-16 LE";
  }
}

class StreamingTerminalOutputDecoder {
  private readonly decoder: TextDecoder | null;

  private pendingAutoOutput = Buffer.alloc(0);

  public constructor(encoding: TerminalOutputEncoding) {
    this.decoder = encoding === "auto" ? null : new TextDecoder(encoding);
  }

  public push(output: Buffer): string {
    if (output.length === 0) return "";
    if (this.decoder !== null) return this.decoder.decode(output, { stream: true });

    // Auto mode keeps the existing per-line UTF-8/GB18030 detection semantics.
    this.pendingAutoOutput = Buffer.concat([this.pendingAutoOutput, output]);
    let decoded = "";
    let lineStart = 0;
    for (let index = 0; index < this.pendingAutoOutput.length; index += 1) {
      const byte = this.pendingAutoOutput[index];
      if (byte !== 0x0a && byte !== 0x0d) continue;
      const end = byte === 0x0d && this.pendingAutoOutput[index + 1] === 0x0a
        ? index + 2
        : index + 1;
      decoded += decodeAutoTerminalLine(this.pendingAutoOutput.subarray(lineStart, end));
      lineStart = end;
      index = end - 1;
    }
    this.pendingAutoOutput = this.pendingAutoOutput.subarray(lineStart);
    return decoded;
  }

  public flush(): string {
    if (this.decoder !== null) return this.decoder.decode();
    const pending = this.pendingAutoOutput;
    this.pendingAutoOutput = Buffer.alloc(0);
    return pending.length === 0 ? "" : decodeAutoTerminalLine(pending);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}
