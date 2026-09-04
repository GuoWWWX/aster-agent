import { describe, expect, it, vi } from "vitest";

import type { ProjectOperationOwner, ToolExecutionResult } from "./project-tool-registry.js";
import { WorkspaceTerminalTabController } from "./workspace-terminal-tab-controller.js";
import {
  TERMINAL_CONTROL_TOOL_NAME,
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
    const closedTabs: string[] = [];
    controller.onOpenRequested((request) => {
      controller.confirmOpened({ requestId: request.requestId, resolvedName: "服务日志 (1)" });
      return true;
    });
    controller.onCloseRequested((request) => {
      closedTabs.push(request.sessionId);
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
      TERMINAL_CONTROL_TOOL_NAME,
    ]);
    const definitions = new Map(
      tool.getDefinitions().map((definition) => [definition.name, definition.description]),
    );
    expect(definitions.get(TERMINAL_CONTROL_TOOL_NAME)).toContain(
      "explicitly asks for a visible, right-side, or interactive terminal",
    );
    expect(definitions.get(TERMINAL_CONTROL_TOOL_NAME)).toContain("use run_command");
    expect(definitions.get(TERMINAL_CONTROL_TOOL_NAME)).toContain("action=list");

    const proposal = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "create", name: "服务日志" }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
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
        terminalContext: { kind: "local" },
      },
    });

    const writeProposal = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "npm run dev",
        terminalId,
        yieldTimeMs: 0,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
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
        terminalContext: { kind: "local" },
      },
    });
    expect(terminalSessions.write).toHaveBeenCalledWith({ data: "npm run dev\r", sessionId: terminalId });

    const read = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "read", terminalId }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    expect(JSON.parse(read.content)).toEqual({
      ok: true,
      value: {
        data: "server ready\r\n",
        nextCursor: 14,
        terminalContext: { kind: "local" },
        terminalId,
        truncated: false,
      },
    });

    const list = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "list" }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    expect(JSON.parse(list.content)).toEqual({
      ok: true,
      value: {
        terminals: [{
          resolvedName: "服务日志 (1)",
          shellLabel: "PWSH（PowerShell 7）",
          terminalId,
          terminalContext: { kind: "local" },
        }],
      },
    });

    const closeProposal = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({ action: "close", terminalId }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (closeProposal.kind !== "approved_action") throw new Error("Expected close approval proposal.");
    expect(JSON.parse((await closeProposal.action.execute()).content)).toEqual({
      ok: true,
      value: { closed: true, terminalId },
    });
    expect(terminalSessions.close).toHaveBeenCalledWith({ sessionId: terminalId });
    expect(closedTabs).toEqual([terminalId]);
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
        action: "write",
        command: "ping baidu.com -n 4",
        terminalId: "00000000-0000-4000-8000-000000000003",
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
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
      rawArguments: JSON.stringify({ action: "create" }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (create.kind !== "approved_action") throw new Error("Expected terminal approval proposal.");
    await create.action.execute();

    const result = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "ping baidu.com -n 4",
        terminalId,
        yieldTimeMs: 8_000,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
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

  it("tracks a persistent SSH shell and refuses remote commands after the SSH child exits", async () => {
    const controller = new WorkspaceTerminalTabController();
    controller.onOpenRequested((request) => {
      controller.confirmOpened({ requestId: request.requestId, resolvedName: "SSH 测试机" });
      return true;
    });
    const terminalId = "00000000-0000-4000-8000-000000000003";
    let transcript = "PS D:\\workspace> ";
    const terminalSessions = {
      close: vi.fn(),
      isActive: vi.fn(() => true),
      open: vi.fn(() => ({ projectId: PROJECT_ID, sessionId: terminalId, shellLabel: "PWSH（PowerShell 7）" })),
      readOutput: vi.fn(({ afterCursor, maxChars }: { afterCursor: number; maxChars: number }) => {
        const data = transcript.slice(afterCursor, afterCursor + maxChars);
        return {
          data,
          nextCursor: afterCursor + data.length,
          truncated: afterCursor + data.length < transcript.length,
        };
      }),
      write: vi.fn(({ data }: { data: string }) => {
        if (data.startsWith("ssh ")) transcript += "administrator@192.168.137.101's password: ";
        else if (data === "secret\r") transcript += "administrator@REMOTE C:\\Users\\Administrator>";
        else if (data.startsWith("ping ")) {
          transcript += "client_loop: send disconnect: Connection reset\r\nPS D:\\workspace> ";
        }
      }),
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
      rawArguments: JSON.stringify({ action: "create", name: "SSH 测试机" }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (create.kind !== "approved_action") throw new Error("Expected terminal approval proposal.");
    await create.action.execute();

    const connect = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "ssh administrator@192.168.137.101",
        terminalId,
        yieldTimeMs: 0,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (connect.kind !== "approved_action") throw new Error("Expected SSH approval proposal.");
    expect(JSON.parse((await connect.action.execute()).content)).toMatchObject({
      ok: true,
      value: {
        terminalContext: { kind: "ssh_connecting", target: "administrator@192.168.137.101" },
      },
    });

    const authenticate = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "secret",
        terminalId,
        yieldTimeMs: 0,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (authenticate.kind !== "approved_action") throw new Error("Expected credential approval proposal.");
    expect(JSON.parse((await authenticate.action.execute()).content)).toMatchObject({
      ok: true,
      value: {
        terminalContext: { kind: "ssh_connected", target: "administrator@192.168.137.101" },
      },
    });

    transcript += "client_loop: send disconnect: Connection reset\r\nPS D:\\workspace> ";
    const remoteCommand = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "ping www.baidu.com",
        expectedContext: "ssh",
        terminalId,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });

    expect(remoteCommand).toMatchObject({ isError: true, kind: "completed" });
    expect(JSON.parse(remoteCommand.content)).toMatchObject({
      code: "TERMINAL_CONTEXT_MISMATCH",
      ok: false,
      recovery: { action: "reconnect_ssh", retryable: true },
      value: {
        delivery: "not_sent",
        sent: false,
        terminalContext: { kind: "ssh_disconnected", target: "administrator@192.168.137.101" },
      },
    });
    expect(terminalSessions.write).toHaveBeenCalledTimes(2);

    for (const command of ["ssh administrator@192.168.137.101", "secret"]) {
      const reconnect = await tool.execute({
        conversationId: CONVERSATION_ID,
        operationOwner: OPERATION_OWNER,
        projectId: PROJECT_ID,
        rawArguments: JSON.stringify({ action: "write", command, terminalId, yieldTimeMs: 0 }),
        signal: new AbortController().signal,
        toolName: TERMINAL_CONTROL_TOOL_NAME,
      });
      if (reconnect.kind !== "approved_action") throw new Error("Expected reconnect approval proposal.");
      await reconnect.action.execute();
    }
    const race = await tool.execute({
      conversationId: CONVERSATION_ID,
      operationOwner: OPERATION_OWNER,
      projectId: PROJECT_ID,
      rawArguments: JSON.stringify({
        action: "write",
        command: "ping www.baidu.com",
        expectedContext: "ssh",
        terminalId,
        yieldTimeMs: 0,
      }),
      signal: new AbortController().signal,
      toolName: TERMINAL_CONTROL_TOOL_NAME,
    });
    if (race.kind !== "approved_action") throw new Error("Expected remote command approval proposal.");
    expect(JSON.parse((await race.action.execute()).content)).toMatchObject({
      code: "TERMINAL_CONTEXT_MISMATCH",
      ok: false,
      value: {
        delivery: "unknown",
        sent: true,
        terminalContext: { kind: "ssh_disconnected" },
      },
    });
  });
});
