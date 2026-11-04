import type { ConversationToolItem } from "@agent/protocol";
import type { CommandExecutionState } from "./command-execution-status.js";
import { parseToolPayload, parseToolValue, parseToolError } from "./tool-result-payload.js";

export type LiveToolOutput = {
  startedAt?: string;
  completedAt?: string | null;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  status: "running" | "completed" | "failed" | "cancelled";
  timedOut: boolean;
  truncated: boolean;
};

type CommandResultPayload = {
  command: string | null;
  commandId: string | null;
  completedAt: string | null;
  exitCode: number | null;
  mode: "batch" | "service" | null;
  stderr: string;
  startedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | null;
  stdout: string;
  timedOut: boolean;
  terminal: {
    displayName: string;
    outputEncoding: string;
  } | null;
  truncated: boolean;
  workingDirectory: string;
};

export function commandTerminalHeaderLabel(
  terminal: { displayName: string } | null,
): string {
  return terminal?.displayName.trim() || "命令行";
}

export function commandTerminalClipboardText(command: string, output: string): string {
  return output.length === 0 ? `$ ${command}` : `$ ${command}\n\n${output}`;
}

export function parseCommandInvocation(payload: string): { command: string } | null {
  const result = parseToolPayload(payload);
  return typeof result?.command === "string"
    ? { command: result.command }
    : null;
}

export function commandExecutionState(
  status: ConversationToolItem["status"], resultPayload: string | null,
  liveOutput: LiveToolOutput | undefined, createdAt?: string,
): CommandExecutionState {
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  return {
    status: status === "awaiting_approval" || status === "failed" || status === "cancelled" || status === "rejected"
      ? status : liveOutput?.status ?? result?.status ?? status,
    startedAt: liveOutput?.startedAt ?? result?.startedAt ?? (status === "running" ? createdAt ?? null : null),
    completedAt: liveOutput?.completedAt ?? result?.completedAt ?? null,
    timedOut: liveOutput?.timedOut ?? result?.timedOut ?? false,
  };
}

export function parseCommandResult(payload: string): CommandResultPayload | null {
  const result = parseToolValue(payload);
  return parseCommandResultValue(result);
}

function parseCommandResultValue(result: Record<string, unknown> | null): CommandResultPayload | null {
  const terminalValue = result?.terminal;
  const terminal = terminalValue !== null && typeof terminalValue === "object"
    ? terminalValue as Record<string, unknown>
    : null;
  return typeof result?.workingDirectory === "string" &&
    (typeof result.exitCode === "number" || result.exitCode === null) &&
    typeof result.stderr === "string" &&
    typeof result.stdout === "string" &&
    typeof result.timedOut === "boolean" &&
    typeof result.truncated === "boolean"
    ? {
      command: typeof result.command === "string" ? result.command : null,
      commandId: typeof result.commandId === "string" ? result.commandId : null,
      completedAt: typeof result.completedAt === "string" ? result.completedAt : null,
      exitCode: result.exitCode,
      mode: result.mode === "batch" || result.mode === "service" ? result.mode : null,
      stderr: result.stderr,
      startedAt: typeof result.startedAt === "string" ? result.startedAt : null,
      status: isCommandSessionStatus(result.status) ? result.status : null,
      stdout: result.stdout,
      terminal: terminal !== null &&
        typeof terminal.displayName === "string" &&
        typeof terminal.outputEncoding === "string"
        ? {
          displayName: terminal.displayName,
          outputEncoding: terminal.outputEncoding,
        }
        : null,
      timedOut: result.timedOut,
      truncated: result.truncated,
      workingDirectory: result.workingDirectory
    }
    : null;
}

export function parseCommandLifecycleResult(
  payload: string,
  mode: "stop" | "wait",
): { commands: CommandResultPayload[]; waitStatus: "finished" | "timeout" | null } | null {
  const result = parseToolValue(payload);
  const rawCommands = mode === "wait"
    ? result?.commands
    : result?.command === null || typeof result?.command !== "object"
      ? null
      : [result.command];
  if (!Array.isArray(rawCommands)) return null;
  const commands = rawCommands.map((command) =>
    parseCommandResultValue(
      command !== null && typeof command === "object"
        ? command as Record<string, unknown>
        : null,
    )
  );
  if (commands.some((command) => command === null)) return null;
  const waitStatus = result?.waitStatus === "finished" || result?.waitStatus === "timeout"
    ? result.waitStatus
    : null;
  return {
    commands: commands as CommandResultPayload[],
    waitStatus,
  };
}

function isCommandSessionStatus(
  value: unknown,
): value is Exclude<CommandResultPayload["status"], null> {
  return value === "running" || value === "completed" || value === "failed" || value === "cancelled";
}

export function commandTerminalOutput(
  resultPayload: string | null,
  status: ConversationToolItem["status"],
  liveOutput?: LiveToolOutput,
): string {
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  if (liveOutput !== undefined && result !== null) {
    return commandTerminalOutputValue({
      ...result,
      exitCode: liveOutput.exitCode,
      status: liveOutput.status,
      stderr: liveOutput.stderr,
      stdout: liveOutput.stdout,
      timedOut: liveOutput.timedOut,
      truncated: liveOutput.truncated,
    });
  }
  if (liveOutput !== undefined) {
    const liveLines = [liveOutput.stdout, liveOutput.stderr].filter((value) => value.length > 0);
    return liveLines.length > 0 ? liveLines.join("\n") : "[命令正在执行]";
  }
  if (resultPayload === null) {
    return status === "running" ? "正在执行..." : "等待命令结果...";
  }
  if (result === null) {
    return parseToolError(resultPayload) ?? "命令执行未返回可显示的终端输出。";
  }

  return commandTerminalOutputValue(result);
}

function commandTerminalOutputValue(result: CommandResultPayload): string {
  const lines = [result.stdout, result.stderr].filter((value) => value.length > 0);
  if (result.status === "running" && lines.length === 0) {
    lines.push(result.mode === "service" ? "[服务正在后台运行]" : "[命令正在后台运行]");
  }
  if (result.status === "cancelled") lines.push("[命令已停止]");
  if (result.timedOut) lines.push("[命令执行超时]");
  if (result.truncated) lines.push("[输出已截断]");
  if (result.status !== "running" && result.exitCode !== 0 && !result.timedOut) {
    lines.push(`[进程退出代码：${result.exitCode ?? "未知"}]`);
  }
  if (lines.length === 0 && result.status === "completed") {
    return "[命令执行完成，未产生输出]";
  }
  return lines.join("\n");
}
