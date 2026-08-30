import { describe, expect, it, vi } from "vitest";

import type { ProjectOperationOwner, ToolExecutionResult } from "./project-tool-registry.js";
import { WorkspaceTerminalTabController } from "./workspace-terminal-tab-controller.js";
import {
  CREATE_TERMINAL_TOOL_NAME,
  EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
  OPEN_TERMINAL_TOOL_NAME,
  READ_TERMINAL_OUTPUT_TOOL_NAME,
  WorkspaceTerminalTool,
} from "./workspace-terminal-tool.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const OPERATION_OWNER: ProjectOperationOwner = {
  conversationId: CONVERSATION_ID,
  conversationTitle: "测试会话",
  runId: "00000000-0000-4000-8000-000000000004",
};

describe("WorkspaceTerminalTool", () => {
  it("creates one persistent PTY-backed side terminal, then writes and reads it", async () => {
    const controller = new WorkspaceTerminalTabController();
    controller.onOpenRequested((request) => {
      controller.confirmOpened({ requestId: request.requestId, resolvedName: "服务日志 (1)" });
      return true;
    });
    const terminalId = "00000000-0000-4000-8000-000000000003";
    const terminalSessions = {
      close: vi.fn(),
      isActive: vi.fn(() => true),
      open: vi.fn(() => ({ projectId: PROJECT_ID, sessionId: terminalId, shellLabel: "PWSH（PowerShell 7）" })),
      readOutput: vi.fn(() => ({ data: "server ready" + String.fromCharCode(13, 10), nextCursor: 14, truncated: false })),
      write: vi.fn(),
    };
    const projectOperations = {
      executeApprovedCommandAction: vi.fn(async (
        _command: string,
        _projectId: string,
        _signal: AbortSignal,
        _owner: ProjectOperationOwner,
        action: () => Promise<ToolExecutionResult>,
      ) => action()),
    };
    const tool = new WorkspaceTerminalTool(controller, terminalSessions, projectOperations);

    expect(tool.getDefinitions().map((definition) => definition.name)).toEqual([
      CREATE_TERMINAL_TOOL_NAME,
      OPEN_TERMINAL_TOOL_NAME,
      EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
      READ_TERMINAL_OUTPUT_TOOL_NAME,
    ]);
    const definitions = new Map(
      tool.getDefinitions().map((definition) => [definition.name, definition.description]),
    );
    expect(definitions.get(CREATE_TERMINAL_TOOL_NAME)).toContain(
      "explicitly asks for a visible, right-side, or interactive terminal",
    );
    expect(definitions.get(CREATE_TERMINAL_TOOL_NAME)).toContain(
      "Use run_command for ordinary commands",
    );
    expect(definitions.get(OPEN_TERMINAL_TOOL_NAME)).toContain(
      "Follow the same selection rule as create_terminal",
    );
    expect(definitions.get(EXECUTE_TERMINAL_COMMAND_TOOL_NAME)).toContain(
      "Do not guess or reuse a terminal tab opened manually by the user",
    );

    const proposal = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ name: "服务日志" }),
      signal: new AbortController().signal,
      toolName: CREATE_TERMINAL_TOOL_NAME,
    });

    expect(proposal).toMatchObject({ isError: false, kind: "approved_action" });
    expect(terminalSessions.open).not.toHaveBeenCalled();
    if (proposal.kind !== "approved_action") throw new Error("Expected terminal approval proposal.");
    const result = await proposal.action.execute();
    expect(projectOperations.executeApprovedCommandAction).toHaveBeenCalledWith(
      "create_terminal",
      PROJECT_ID,
      expect.any(AbortSignal),
      OPERATION_OWNER,
      expect.any(Function),
    );
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      value: {
        nameAdjusted: true,
        opened: true,
        requestedName: "服务日志",
        resolvedName: "服务日志 (1)",
        terminalId,
      },
    });

    const writeProposal = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ command: "npm run dev", terminalId, yieldTimeMs: 0 }),
      signal: new AbortController().signal,
      toolName: EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
    });
    expect(terminalSessions.write).not.toHaveBeenCalled();
    if (writeProposal.kind !== "approved_action") throw new Error("Expected command approval proposal.");
    const write = await writeProposal.action.execute();
    expect(projectOperations.executeApprovedCommandAction).toHaveBeenLastCalledWith(
      "npm run dev",
      PROJECT_ID,
      expect.any(AbortSignal),
      OPERATION_OWNER,
      expect.any(Function),
    );
    expect(JSON.parse(write.content)).toEqual({
      ok: true,
      value: {
        effectiveYieldTimeMs: 0,
        output: { data: "server ready\r\n", nextCursor: 14, truncated: false },
        sent: true,
        terminalId,
      },
    });
    expect(terminalSessions.write).toHaveBeenCalledWith({ data: "npm run dev\r", sessionId: terminalId });

    const read = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ terminalId }),
      signal: new AbortController().signal,
      toolName: READ_TERMINAL_OUTPUT_TOOL_NAME,
    });
    expect(JSON.parse(read.content)).toEqual({
      ok: true,
      value: { data: "server ready\r\n", nextCursor: 14, terminalId, truncated: false },
    });
  });

  it("tells the model to recreate a terminal when a historical terminal id is no longer active", async () => {
    const controller = new WorkspaceTerminalTabController();
    const terminalSessions = {
      close: vi.fn(),
      isActive: vi.fn(() => false),
      open: vi.fn(),
      readOutput: vi.fn(),
      write: vi.fn(),
    };
    const tool = new WorkspaceTerminalTool(controller, terminalSessions, {
      executeApprovedCommandAction: vi.fn(),
    });

    const result = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        command: "ping baidu.com -n 4",
        terminalId: "00000000-0000-4000-8000-000000000003",
      }),
      signal: new AbortController().signal,
      toolName: EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
    });

    expect(result).toMatchObject({ isError: true, kind: "completed" });
    expect(JSON.parse(result.content)).toMatchObject({
      agentError: { code: "CONFLICT", retryable: true },
      code: "TERMINAL_UNAVAILABLE",
      ok: false,
      recovery: {
        action: "recreate_terminal",
        retryable: true,
      },
    });
  });

  it("accepts an oversized immediate-output wait hint so it can be capped at execution time", async () => {
    const controller = new WorkspaceTerminalTabController();
    controller.onOpenRequested((request) => {
      controller.confirmOpened({ requestId: request.requestId, resolvedName: "测试终端" });
      return true;
    });
    const terminalId = "00000000-0000-4000-8000-000000000003";
    const terminalSessions = {
      close: vi.fn(),
      isActive: vi.fn(() => true),
      open: vi.fn(() => ({ projectId: PROJECT_ID, sessionId: terminalId, shellLabel: "PWSH（PowerShell 7）" })),
      readOutput: vi.fn(() => ({ data: "", nextCursor: 0, truncated: false })),
      write: vi.fn(),
    };
    const projectOperations = {
      executeApprovedCommandAction: vi.fn(async (
        _command: string,
        _projectId: string,
        _signal: AbortSignal,
        _owner: ProjectOperationOwner,
        action: () => Promise<ToolExecutionResult>,
      ) => action()),
    };
    const tool = new WorkspaceTerminalTool(controller, terminalSessions, projectOperations);
    const create = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: "{}",
      signal: new AbortController().signal,
      toolName: CREATE_TERMINAL_TOOL_NAME,
    });
    if (create.kind !== "approved_action") throw new Error("Expected terminal approval proposal.");
    await create.action.execute();

    const result = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        command: "ping baidu.com -n 4",
        terminalId,
        yieldTimeMs: 8_000,
      }),
      signal: new AbortController().signal,
      toolName: EXECUTE_TERMINAL_COMMAND_TOOL_NAME,
    });

    expect(result).toMatchObject({ isError: false, kind: "approved_action" });
    if (result.kind !== "approved_action") throw new Error("Expected command approval proposal.");
    vi.useFakeTimers();
    try {
      const execution = result.action.execute();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(JSON.parse((await execution).content)).toMatchObject({
        ok: true,
        value: { effectiveYieldTimeMs: 5_000, sent: true, terminalId },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
