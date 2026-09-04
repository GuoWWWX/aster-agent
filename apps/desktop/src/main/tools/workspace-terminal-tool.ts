import { z } from "zod";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type {
  ProjectOperationOwner,
  ProjectToolRegistry,
  ToolExecution,
  ToolExecutionResult,
} from "./project-tool-registry.js";
import {
  TerminalSessionUnavailableError,
  type TerminalSessionPort,
} from "./terminal-session-controller.js";
import type { WorkspaceTerminalTabPort } from "./workspace-terminal-tab-controller.js";

const MAX_IMMEDIATE_OUTPUT_WAIT_MS = 5_000;

const createTerminalArgumentsSchema = z.object({
  columns: z.number().int().min(2).max(500).default(120)
    .describe("Initial terminal column count. The visible tab resizes it after mounting."),
  name: z.string().trim().min(1).max(120)
    .optional()
    .describe("Optional terminal tab name. The actual unique name is returned after the workspace opens it."),
  rows: z.number().int().min(1).max(300).default(32)
    .describe("Initial terminal row count. The visible tab resizes it after mounting."),
}).strict();

const executeTerminalCommandArgumentsSchema = z.object({
  afterCursor: z.number().int().nonnegative().default(0)
    .describe("Read command output after this cursor. Reuse nextCursor from an earlier terminal result."),
  command: z.string().min(1).max(32_000)
    .describe("One command to send to the persistent terminal. Enter is appended automatically."),
  expectedContext: z.enum(["local", "ssh"])
    .optional()
    .describe("Expected shell context. Set ssh for every command intended for an established SSH shell so a disconnected session cannot run it locally."),
  maxChars: z.number().int().min(1).max(65_536).default(32_768)
    .describe("Maximum output characters included in this command's immediate result."),
  terminalId: z.string().uuid().describe(
    "Live terminal ID returned by create_terminal or open_terminal for this conversation in the current app session.",
  ),
  yieldTimeMs: z.number().int().min(0).default(200)
    .describe("Optional immediate-output wait in milliseconds. Omit normally; values above 5000 are capped at 5000. This never waits for command completion."),
}).strict();

const readTerminalOutputArgumentsSchema = z.object({
  afterCursor: z.number().int().nonnegative().default(0)
    .describe("Read output after this cursor. Pass nextCursor from the prior result to read only new output."),
  maxChars: z.number().int().min(1).max(65_536).default(32_768)
    .describe("Maximum transcript characters to return."),
  terminalId: z.string().uuid().describe(
    "Live terminal ID returned by create_terminal or open_terminal for this conversation in the current app session.",
  ),
}).strict();

const terminalReferenceArgumentsSchema = z.object({
  terminalId: z.string().uuid().describe(
    "Live terminal ID returned by terminal_control action=create or action=list for this conversation in the current app session.",
  ),
}).strict();

const terminalControlArgumentsSchema = z.object({
  action: z.enum(["create", "list", "write", "read", "close"])
    .describe("Persistent side-terminal action to perform."),
  afterCursor: z.number().int().nonnegative().optional()
    .describe("For write/read, return output after this cursor. Reuse nextCursor to avoid duplicate output."),
  columns: z.number().int().min(2).max(500).optional()
    .describe("For create, initial terminal columns; defaults to 120 and is resized by the visible tab."),
  command: z.string().min(1).max(32_000).optional()
    .describe("Command required for write. Enter is appended automatically."),
  expectedContext: z.enum(["local", "ssh"]).optional()
    .describe("For write, expected shell context. Always set ssh for commands intended for an established SSH shell."),
  maxChars: z.number().int().min(1).max(65_536).optional()
    .describe("For write/read, maximum output characters returned; defaults to 32768."),
  name: z.string().trim().min(1).max(120).optional()
    .describe("For create, optional visible tab name. The returned resolvedName is authoritative."),
  rows: z.number().int().min(1).max(300).optional()
    .describe("For create, initial terminal rows; defaults to 32 and is resized by the visible tab."),
  terminalId: z.string().uuid().optional()
    .describe("Terminal ID required for write, read and close. Use list if the active ID is no longer in context."),
  yieldTimeMs: z.number().int().min(0).optional()
    .describe("For write, immediate-output sampling delay; defaults to 200 and values above 5000 are capped."),
}).strict();

export const OPEN_TERMINAL_TOOL_NAME = "open_terminal";
export const CREATE_TERMINAL_TOOL_NAME = "create_terminal";
export const EXECUTE_TERMINAL_COMMAND_TOOL_NAME = "execute_terminal_command";
export const READ_TERMINAL_OUTPUT_TOOL_NAME = "read_terminal_output";
export const TERMINAL_CONTROL_TOOL_NAME = "terminal_control";

type OwnedTerminal = {
  conversationId: string;
  context: TerminalContext;
  inspectionCursor: number;
  projectId: string;
  resolvedName: string;
  shellLabel: string;
};

type TerminalContext =
  | { kind: "local" }
  | { kind: "ssh_connecting" | "ssh_connected" | "ssh_disconnected"; target: string };

class TerminalContextMismatchError extends Error {
  public readonly code = "TERMINAL_CONTEXT_MISMATCH";

  public constructor(
    public readonly context: TerminalContext,
    public readonly delivery: "not_sent" | "unknown" = "not_sent",
  ) {
    super("The terminal is alive, but the requested SSH shell is not connected.");
    this.name = "TerminalContextMismatchError";
  }
}

export class WorkspaceTerminalTool {
  private readonly terminals = new Map<string, OwnedTerminal>();

  public constructor(
    private readonly terminalTabs: WorkspaceTerminalTabPort,
    private readonly terminalSessions: TerminalSessionPort,
    private readonly projectOperations: Pick<ProjectToolRegistry, "executeApprovedCommandAction">,
  ) {}

  public getDefinitions(): readonly ModelToolDefinition[] {
    return [
      {
        description: "Control AI-managed, user-visible right-side persistent PTY terminals for the current project. Use this only when the user explicitly asks for a visible, right-side, or interactive terminal, or the task genuinely needs a persistent PTY the user can inspect or take over; use run_command for ordinary commands, builds, checks and tests. Use action=create before write when no live terminalId is available, action=list to recover active IDs and their current local/SSH context, action=write to send one command and sample immediate output, action=read with nextCursor for later incremental output, and action=close to close the PTY and its tab. For a reusable SSH shell, send an interactive `ssh [options] user@host` command without a trailing remote command, complete authentication, then read until terminalContext.kind is ssh_connected. For every later command intended for that remote shell, pass expectedContext=ssh; the tool refuses delivery after SSH disconnects instead of running it in the local shell. A one-shot `ssh host command` exits back to local and must not be treated as reusable. IDs are scoped to this conversation and current app session; never guess an ID or use a terminal opened manually by the user.",
        name: TERMINAL_CONTROL_TOOL_NAME,
        parameters: modelToolParameters(terminalControlArgumentsSchema),
      },
    ];
  }

  public execute(input: {
    conversationId: string;
    projectId: string | undefined;
    operationOwner: ProjectOperationOwner;
    rawArguments: string;
    signal: AbortSignal;
    toolName: string;
  }): Promise<ToolExecution> {
    try {
      if (input.projectId === undefined) {
        throw new Error("A workspace is required to open an interactive terminal tab.");
      }
      const projectInput = { ...input, projectId: input.projectId };
      switch (input.toolName) {
        case TERMINAL_CONTROL_TOOL_NAME:
          return Promise.resolve(this.executeControl(projectInput));
        case CREATE_TERMINAL_TOOL_NAME:
        case OPEN_TERMINAL_TOOL_NAME:
          return Promise.resolve(this.prepareCreateTerminal(projectInput));
        case EXECUTE_TERMINAL_COMMAND_TOOL_NAME:
          return Promise.resolve(this.prepareTerminalCommand(projectInput));
        case READ_TERMINAL_OUTPUT_TOOL_NAME:
          return Promise.resolve(this.readTerminalOutput(projectInput));
        default:
          throw new Error(`Unsupported workspace terminal tool: ${input.toolName}`);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
      return Promise.resolve({
        content: terminalToolErrorContent(error, input.toolName),
        isError: true,
        kind: "completed" as const,
      });
    }
  }

  private executeControl(input: {
    conversationId: string;
    operationOwner: ProjectOperationOwner;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }): ToolExecution {
    const control = terminalControlArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    const { action, ...actionArguments } = control;
    switch (action) {
      case "create":
        return this.prepareCreateTerminal(
          input,
          createTerminalArgumentsSchema.parse(actionArguments),
        );
      case "list":
        z.object({}).strict().parse(actionArguments);
        return this.listTerminals(input.conversationId, input.projectId);
      case "write":
        return this.prepareTerminalCommand(
          input,
          executeTerminalCommandArgumentsSchema.parse(actionArguments),
        );
      case "read":
        return this.readTerminalOutput(
          input,
          readTerminalOutputArgumentsSchema.parse(actionArguments),
        );
      case "close":
        return this.prepareCloseTerminal(
          input,
          terminalReferenceArgumentsSchema.parse(actionArguments),
        );
    }
  }

  private prepareCreateTerminal(input: {
    conversationId: string;
    operationOwner: ProjectOperationOwner;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }, arguments_ = createTerminalArgumentsSchema.parse(
    parseToolArguments(input.rawArguments),
  )): ToolExecution {
    return {
      action: {
        execute: () => this.projectOperations.executeApprovedCommandAction(
          "create_terminal",
          input.projectId,
          input.signal,
          input.operationOwner,
          () => this.createTerminal(input, arguments_),
        ),
        pattern: "create_terminal",
        permissionTool: "run_command",
        rejectionMessage: "The user rejected creating a persistent terminal.",
        rejectionValue: { status: "rejected" },
      },
      content: JSON.stringify({ ok: true, value: { status: "awaiting_approval" } }),
      isError: false,
      kind: "approved_action",
    };
  }

  private async createTerminal(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
    operationOwner: ProjectOperationOwner;
  }, arguments_: z.infer<typeof createTerminalArgumentsSchema>): Promise<ToolExecutionResult> {
    const session = this.terminalSessions.open({
      columns: arguments_.columns,
      projectId: input.projectId,
      rows: arguments_.rows,
    });
    try {
      const opened = await this.terminalTabs.open({
        conversationId: input.conversationId,
        projectId: input.projectId,
        requestedName: arguments_.name ?? null,
        session,
        signal: input.signal,
      });
      this.terminals.set(session.sessionId, {
        conversationId: input.conversationId,
        context: { kind: "local" },
        inspectionCursor: 0,
        projectId: input.projectId,
        resolvedName: opened.resolvedName,
        shellLabel: session.shellLabel,
      });
      return {
        content: JSON.stringify({
          ok: true,
          value: {
            nameAdjusted: opened.requestedName !== null && opened.requestedName !== opened.resolvedName,
            opened: true,
            requestedName: opened.requestedName,
            resolvedName: opened.resolvedName,
            terminalId: session.sessionId,
            terminalContext: { kind: "local" },
          },
        }),
        isError: false,
        kind: "completed",
      };
    } catch (error) {
      this.terminalSessions.close({ sessionId: session.sessionId });
      throw error;
    }
  }

  private prepareTerminalCommand(input: {
    conversationId: string;
    operationOwner: ProjectOperationOwner;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }, arguments_ = executeTerminalCommandArgumentsSchema.parse(
    parseToolArguments(input.rawArguments),
  )): ToolExecution {
    const terminal = this.requireOwnedTerminal(
      input.conversationId,
      input.projectId,
      arguments_.terminalId,
    );
    this.refreshTerminalContext(arguments_.terminalId, terminal);
    this.assertTerminalContext(terminal, arguments_);
    return {
      action: {
        execute: () => this.projectOperations.executeApprovedCommandAction(
          arguments_.command,
          input.projectId,
          input.signal,
          input.operationOwner,
          () => this.executeTerminalCommand(input, arguments_),
        ),
        pattern: arguments_.command,
        permissionTool: "run_command",
        rejectionMessage: "The user rejected this terminal command.",
        rejectionValue: { command: arguments_.command, status: "rejected" },
      },
      content: JSON.stringify({
        ok: true,
        value: { command: arguments_.command, status: "awaiting_approval" },
      }),
      isError: false,
      kind: "approved_action",
    };
  }

  private async executeTerminalCommand(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }, arguments_: z.infer<typeof executeTerminalCommandArgumentsSchema>): Promise<ToolExecutionResult> {
    try {
      const terminal = this.requireOwnedTerminal(
        input.conversationId,
        input.projectId,
        arguments_.terminalId,
      );
      this.refreshTerminalContext(arguments_.terminalId, terminal);
      this.assertTerminalContext(terminal, arguments_);
      const sshInvocation = parseSshInvocation(arguments_.command);
      const exitsSsh = terminal.context.kind === "ssh_connected"
        && /^(?:exit|logout)\s*$/iu.test(arguments_.command.trim());
      if (sshInvocation?.interactive === true) {
        terminal.context = { kind: "ssh_connecting", target: sshInvocation.target };
      } else if (arguments_.expectedContext === "local" && terminal.context.kind === "ssh_disconnected") {
        terminal.context = { kind: "local" };
      }
      const data = /[\r\n]$/u.test(arguments_.command)
        ? arguments_.command
        : `${arguments_.command}\r`;
      this.terminalSessions.write({ data, sessionId: arguments_.terminalId });
      const effectiveYieldTimeMs = Math.min(
        arguments_.yieldTimeMs,
        MAX_IMMEDIATE_OUTPUT_WAIT_MS,
      );
      await waitForTerminalOutput(effectiveYieldTimeMs, input.signal);
      this.refreshTerminalContext(arguments_.terminalId, terminal);
      if (exitsSsh) terminal.context = { kind: "local" };
      const output = this.terminalSessions.readOutput({
        afterCursor: arguments_.afterCursor,
        maxChars: arguments_.maxChars,
        sessionId: arguments_.terminalId,
      });
      if (arguments_.expectedContext === "ssh" && terminal.context.kind !== "ssh_connected") {
        return {
          content: terminalToolErrorContent(
            new TerminalContextMismatchError(terminal.context, "unknown"),
            TERMINAL_CONTROL_TOOL_NAME,
          ),
          isError: true,
          kind: "completed",
        };
      }
      return {
        content: JSON.stringify({
          ok: true,
          value: {
            effectiveYieldTimeMs,
            output,
            sent: true,
            terminalId: arguments_.terminalId,
            terminalContext: terminal.context,
          },
        }),
        isError: false,
        kind: "completed",
      };
    } catch (error) {
      if (input.signal.aborted) throw error;
      if (
        !(error instanceof TerminalSessionUnavailableError)
        && !(error instanceof TerminalContextMismatchError)
      ) throw error;
      return {
        content: terminalToolErrorContent(error, TERMINAL_CONTROL_TOOL_NAME),
        isError: true,
        kind: "completed",
      };
    }
  }

  private readTerminalOutput(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
  }, arguments_ = readTerminalOutputArgumentsSchema.parse(
    parseToolArguments(input.rawArguments),
  )): ToolExecution {
    const terminal = this.requireOwnedTerminal(
      input.conversationId,
      input.projectId,
      arguments_.terminalId,
    );
    this.refreshTerminalContext(arguments_.terminalId, terminal);
    const output = this.terminalSessions.readOutput({
      afterCursor: arguments_.afterCursor,
      maxChars: arguments_.maxChars,
      sessionId: arguments_.terminalId,
    });
    return {
      content: JSON.stringify({
        ok: true,
        value: {
          terminalId: arguments_.terminalId,
          terminalContext: terminal.context,
          ...output,
        },
      }),
      isError: false,
      kind: "completed",
    };
  }

  private listTerminals(conversationId: string, projectId: string): ToolExecution {
    const terminals = [];
    for (const [terminalId, terminal] of this.terminals) {
      if (!this.terminalSessions.isActive({ sessionId: terminalId })) {
        this.terminals.delete(terminalId);
        continue;
      }
      if (terminal.conversationId !== conversationId || terminal.projectId !== projectId) continue;
      this.refreshTerminalContext(terminalId, terminal);
      terminals.push({
        resolvedName: terminal.resolvedName,
        shellLabel: terminal.shellLabel,
        terminalId,
        terminalContext: terminal.context,
      });
    }
    return {
      content: JSON.stringify({ ok: true, value: { terminals } }),
      isError: false,
      kind: "completed",
    };
  }

  private prepareCloseTerminal(input: {
    conversationId: string;
    operationOwner: ProjectOperationOwner;
    projectId: string;
    signal: AbortSignal;
  }, arguments_: z.infer<typeof terminalReferenceArgumentsSchema>): ToolExecution {
    this.requireOwnedTerminal(input.conversationId, input.projectId, arguments_.terminalId);
    return {
      action: {
        execute: () => this.projectOperations.executeApprovedCommandAction(
          `close_terminal:${arguments_.terminalId}`,
          input.projectId,
          input.signal,
          input.operationOwner,
          () => Promise.resolve(this.closeTerminal(input.conversationId, arguments_.terminalId)),
        ),
        pattern: `close_terminal:${arguments_.terminalId}`,
        permissionTool: "run_command",
        rejectionMessage: "The user rejected closing this persistent terminal.",
        rejectionValue: { status: "rejected", terminalId: arguments_.terminalId },
      },
      content: JSON.stringify({
        ok: true,
        value: { status: "awaiting_approval", terminalId: arguments_.terminalId },
      }),
      isError: false,
      kind: "approved_action",
    };
  }

  private closeTerminal(conversationId: string, terminalId: string): ToolExecutionResult {
    this.terminalSessions.close({ sessionId: terminalId });
    this.terminalTabs.close({ conversationId, sessionId: terminalId });
    this.terminals.delete(terminalId);
    return {
      content: JSON.stringify({ ok: true, value: { closed: true, terminalId } }),
      isError: false,
      kind: "completed",
    };
  }

  private requireOwnedTerminal(
    conversationId: string,
    projectId: string,
    terminalId: string,
  ): OwnedTerminal {
    const terminal = this.terminals.get(terminalId);
    if (terminal === undefined || terminal.conversationId !== conversationId || terminal.projectId !== projectId) {
      throw new TerminalSessionUnavailableError();
    }
    if (!this.terminalSessions.isActive({ sessionId: terminalId })) {
      this.terminals.delete(terminalId);
      throw new TerminalSessionUnavailableError();
    }
    return terminal;
  }

  private assertTerminalContext(
    terminal: OwnedTerminal,
    arguments_: z.infer<typeof executeTerminalCommandArgumentsSchema>,
  ): void {
    const sshInvocation = parseSshInvocation(arguments_.command);
    if (sshInvocation !== null) return;
    if (arguments_.expectedContext === "ssh" && terminal.context.kind !== "ssh_connected") {
      throw new TerminalContextMismatchError(terminal.context);
    }
    if (arguments_.expectedContext === "local" && terminal.context.kind === "ssh_connected") {
      throw new TerminalContextMismatchError(terminal.context);
    }
    if (
      arguments_.expectedContext === undefined
      && terminal.context.kind === "ssh_disconnected"
    ) {
      throw new TerminalContextMismatchError(terminal.context);
    }
  }

  private refreshTerminalContext(terminalId: string, terminal: OwnedTerminal): void {
    for (let index = 0; index < 8; index += 1) {
      const output = this.terminalSessions.readOutput({
        afterCursor: terminal.inspectionCursor,
        maxChars: 65_536,
        sessionId: terminalId,
      });
      terminal.inspectionCursor = output.nextCursor;
      updateTerminalContextFromOutput(terminal, output.data);
      if (!output.truncated || output.data.length === 0) return;
    }
  }
}

function terminalToolErrorContent(error: unknown, toolName: string): string {
  return error instanceof TerminalContextMismatchError
    ? toolErrorContent(error, `tool:${toolName}`, {
        code: "TERMINAL_CONTEXT_MISMATCH",
        recovery: {
          action: "reconnect_ssh",
          instruction: error.delivery === "not_sent"
            ? "这条命令尚未写入终端。PTY 仍在运行，但其中的 SSH 子会话没有连接。先发送不带远程命令的交互式 ssh user@host，完成认证并读取到 terminalContext.kind=ssh_connected；随后用 expectedContext=ssh 重试远程命令。"
            : "这条命令已经写入终端后才检测到 SSH 断开，远端是否执行未知。先重新连接并检查远端实际状态；只有确认未执行时才重新发送，不要盲目重试副作用命令。",
          retryable: true,
        },
        value: {
          delivery: error.delivery,
          sent: error.delivery === "unknown",
          terminalContext: error.context,
        },
      })
    : error instanceof TerminalSessionUnavailableError
    ? toolErrorContent(error, `tool:${toolName}`, {
        code: "TERMINAL_UNAVAILABLE",
        recovery: {
          action: "recreate_terminal",
          instruction: "这个 terminalId 已失效。先调用 terminal_control action=list 查找当前对话的活动终端；没有可用终端时调用 action=create，再使用返回的新 terminalId 重试。不要继续重试旧 ID。",
          retryable: true,
        },
      })
    : toolErrorContent(error, `tool:${toolName}`);
}

function parseSshInvocation(command: string): {
  interactive: boolean;
  target: string;
} | null {
  const tokens = tokenizeShellCommand(command.trim());
  if (tokens.length < 2 || !/^ssh(?:\.exe)?$/iu.test(tokens[0] ?? "")) return null;
  const optionsWithValues = new Set([
    "-b", "-c", "-D", "-E", "-F", "-I", "-i", "-J", "-L", "-l", "-m",
    "-O", "-o", "-p", "-Q", "-R", "-S", "-W", "-w",
  ]);
  let destinationIndex = 1;
  while (destinationIndex < tokens.length) {
    const token = tokens[destinationIndex] ?? "";
    if (token === "--") {
      destinationIndex += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;
    destinationIndex += optionsWithValues.has(token) ? 2 : 1;
  }
  const target = tokens[destinationIndex];
  if (target === undefined) return null;
  return {
    interactive: destinationIndex === tokens.length - 1,
    target,
  };
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  for (const character of command) {
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function updateTerminalContextFromOutput(terminal: OwnedTerminal, output: string): void {
  if (terminal.context.kind === "local" || output.length === 0) return;
  const target = terminal.context.target;
  const plainOutput = stripTerminalControlSequences(output);
  if (
    terminal.context.kind === "ssh_connecting"
    && /(?:password:\s*|yes\/no\]\?\s*|verification code:\s*)$/iu.test(plainOutput.trimEnd())
  ) return;
  if (/(?:client_loop:\s*send disconnect|connection (?:closed|reset|refused|timed out)|could not resolve hostname|host key verification failed|permission denied|ssh:\s*connect to host)/iu.test(plainOutput)) {
    terminal.context = { kind: "ssh_disconnected", target };
    return;
  }
  if (terminal.context.kind !== "ssh_connecting") return;
  if (/[#$>%]\s*$/u.test(plainOutput.trimEnd())) {
    terminal.context = { kind: "ssh_connected", target };
  }
}

function stripTerminalControlSequences(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code === 27) {
      const introducer = value.codePointAt(index + 1);
      if (introducer === 91) {
        index += 2;
        while (index < value.length) {
          const sequenceCode = value.codePointAt(index) ?? 0;
          if (sequenceCode >= 64 && sequenceCode <= 126) break;
          index += 1;
        }
      } else if (introducer === 93) {
        index += 2;
        while (index < value.length) {
          const sequenceCode = value.codePointAt(index) ?? 0;
          if (sequenceCode === 7) break;
          if (sequenceCode === 27 && value.codePointAt(index + 1) === 92) {
            index += 1;
            break;
          }
          index += 1;
        }
      }
      continue;
    }
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) continue;
    result += value[index] ?? "";
  }
  return result;
}

function waitForTerminalOutput(timeoutMs: number, signal: AbortSignal): Promise<void> {
  if (timeoutMs === 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
