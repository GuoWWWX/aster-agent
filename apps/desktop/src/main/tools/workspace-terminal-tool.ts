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
import type { TerminalSessionPort } from "./terminal-session-controller.js";
import type { WorkspaceTerminalTabPort } from "./workspace-terminal-tab-controller.js";

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
  maxChars: z.number().int().min(1).max(65_536).default(32_768)
    .describe("Maximum output characters included in this command's immediate result."),
  terminalId: z.string().uuid().describe("Terminal ID returned by create_terminal or open_terminal."),
  yieldTimeMs: z.number().int().min(0).max(5_000).default(200)
    .describe("Briefly wait for immediate output. This never waits for a long-running command to finish."),
}).strict();

const readTerminalOutputArgumentsSchema = z.object({
  afterCursor: z.number().int().nonnegative().default(0)
    .describe("Read output after this cursor. Pass nextCursor from the prior result to read only new output."),
  maxChars: z.number().int().min(1).max(65_536).default(32_768)
    .describe("Maximum transcript characters to return."),
  terminalId: z.string().uuid().describe("Terminal ID returned by create_terminal or open_terminal."),
}).strict();

export const OPEN_TERMINAL_TOOL_NAME = "open_terminal";
export const CREATE_TERMINAL_TOOL_NAME = "create_terminal";
export const EXECUTE_TERMINAL_COMMAND_TOOL_NAME = "execute_terminal_command";
export const READ_TERMINAL_OUTPUT_TOOL_NAME = "read_terminal_output";

type OwnedTerminal = {
  conversationId: string;
  projectId: string;
};

export class WorkspaceTerminalTool {
  private readonly terminals = new Map<string, OwnedTerminal>();

  public constructor(
    private readonly terminalTabs: WorkspaceTerminalTabPort,
    private readonly terminalSessions: TerminalSessionPort,
    private readonly projectOperations: Pick<ProjectToolRegistry, "executeApprovedCommandAction">,
  ) {}

  public getDefinitions(): readonly ModelToolDefinition[] {
    const createDefinition: ModelToolDefinition = {
      description:
        "Create a persistent AI-managed terminal in a visible right-side terminal tab for the current project. The returned terminalId identifies the same long-lived PTY for execute_terminal_command and read_terminal_output. name is optional; the workspace resolves duplicate labels and returns resolvedName.",
      name: CREATE_TERMINAL_TOOL_NAME,
      parameters: modelToolParameters(createTerminalArgumentsSchema),
    };
    return [
      createDefinition,
      {
        ...createDefinition,
        description: "Compatibility alias for create_terminal. Creates a persistent visible terminal and returns its terminalId.",
        name: OPEN_TERMINAL_TOOL_NAME,
      },
      {
        description:
          "Send one command to a persistent AI-managed terminal and press Enter. It returns a brief incremental-output sample, not command completion; use read_terminal_output to continue inspecting a long-running process in the visible terminal tab.",
        name: EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
        parameters: modelToolParameters(executeTerminalCommandArgumentsSchema),
      },
      {
        description:
          "Read a bounded incremental transcript from one persistent AI-managed terminal. Reuse nextCursor to avoid receiving the same output twice. The terminal remains running and user-accessible in its right-side tab.",
        name: READ_TERMINAL_OUTPUT_TOOL_NAME,
        parameters: modelToolParameters(readTerminalOutputArgumentsSchema),
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
        content: toolErrorContent(error, `tool:${input.toolName}`),
        isError: true,
        kind: "completed" as const,
      });
    }
  }

  private prepareCreateTerminal(input: {
    conversationId: string;
    operationOwner: ProjectOperationOwner;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }): ToolExecution {
    const arguments_ = createTerminalArgumentsSchema.parse(parseToolArguments(input.rawArguments));
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
        projectId: input.projectId,
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
  }): ToolExecution {
    const arguments_ = executeTerminalCommandArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedTerminal(input.conversationId, input.projectId, arguments_.terminalId);
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
    this.requireOwnedTerminal(input.conversationId, input.projectId, arguments_.terminalId);
    const data = /[\r\n]$/u.test(arguments_.command)
      ? arguments_.command
      : `${arguments_.command}\r`;
    this.terminalSessions.write({ data, sessionId: arguments_.terminalId });
    await waitForTerminalOutput(arguments_.yieldTimeMs, input.signal);
    const output = this.terminalSessions.readOutput({
      afterCursor: arguments_.afterCursor,
      maxChars: arguments_.maxChars,
      sessionId: arguments_.terminalId,
    });
    return {
      content: JSON.stringify({
        ok: true,
        value: { output, sent: true, terminalId: arguments_.terminalId },
      }),
      isError: false,
      kind: "completed",
    };
  }

  private readTerminalOutput(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
  }): ToolExecution {
    const arguments_ = readTerminalOutputArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedTerminal(input.conversationId, input.projectId, arguments_.terminalId);
    const output = this.terminalSessions.readOutput({
      afterCursor: arguments_.afterCursor,
      maxChars: arguments_.maxChars,
      sessionId: arguments_.terminalId,
    });
    return {
      content: JSON.stringify({ ok: true, value: { terminalId: arguments_.terminalId, ...output } }),
      isError: false,
      kind: "completed",
    };
  }

  private requireOwnedTerminal(conversationId: string, projectId: string, terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal === undefined || terminal.conversationId !== conversationId || terminal.projectId !== projectId) {
      throw new Error("The terminal does not belong to this conversation.");
    }
  }
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
