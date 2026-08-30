import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ModelRequestError, ModelResponseError } from "../model/model-request-error.js";
import { parseToolArguments } from "../model/tool-arguments.js";
import {
  reportMainError,
  sanitizeSensitiveText,
  toMainAgentError,
} from "./agent-error.js";

describe("main agent errors", () => {
  it("maps provider failures to a stable retryable error", () => {
    const error = toMainAgentError(
      new ModelRequestError(503, "Model request failed (503): upstream unavailable"),
      { operation: "agent.run" },
    );

    expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("模型服务暂时不可用");
    expect(error.details).toMatchObject({
      operation: "agent.run",
      providerMessage: "upstream unavailable",
      status: 503
    });
  });

  it("maps validation and workspace errors without exposing internal English messages", () => {
    expect(
      toMainAgentError(new Error("Temporary conversations cannot access project tools."), {
        operation: "tool.execute",
      }).code,
    ).toBe("WORKSPACE_REQUIRED");
    expect(
      toMainAgentError(new Error("Project path is outside the registered project root."), {
        operation: "project.read",
      }).code,
    ).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(
      toMainAgentError(new Error("Expected 1 exact matches, found 2. Read the file and retry."), {
        operation: "tool:replace_in_file",
      }).code,
    ).toBe("VALIDATION_FAILED");
    expect(
      toMainAgentError(new Error("module not found: process"), {
        operation: "electron.preload",
      }).code,
    ).toBe("INTERNAL_ERROR");
    expect(
      toMainAgentError(
        new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString."),
        { operation: "model.get_api_key" },
      ).code,
    ).toBe("MODEL_CONFIGURATION_INVALID");
  });

  it("keeps terminal startup failures actionable instead of treating them as missing artifacts", () => {
    const error = Object.assign(
      new Error("无法启动PWSH（PowerShell 7）。请检查设置中的终端启动路径和项目目录。"),
      { code: "TERMINAL_LAUNCH_FAILED" },
    );

    expect(toMainAgentError(error, { operation: "ipc:terminal.session_open" })).toMatchObject({
      code: "PROCESS_FAILED",
      message: "无法启动PWSH（PowerShell 7）。请检查设置中的终端启动路径和项目目录。",
      retryable: false,
    });
  });

  it("keeps model transport timeouts separate from command timeouts", () => {
    expect(toMainAgentError(
      new Error("Command execution timed out."),
      { operation: "agent.run" },
    )).toMatchObject({
      code: "MODEL_TIMEOUT",
      message: "模型请求超时，请检查网络后重试。",
      retryable: true,
    });
    expect(toMainAgentError(
      new Error("Command execution timed out."),
      { operation: "tool:run_command" },
    )).toMatchObject({
      code: "PROCESS_TIMEOUT",
      message: "命令执行超时。",
      retryable: true,
    });
  });

  it("classifies an ended or restarted terminal as a recoverable conflict", () => {
    const error = Object.assign(
      new Error("终端会话已结束或桌面服务已重启，请重新打开终端后重试。"),
      { code: "TERMINAL_UNAVAILABLE" },
    );

    expect(toMainAgentError(error, { operation: "tool:execute_terminal_command" })).toMatchObject({
      code: "CONFLICT",
      message: "终端会话已结束或桌面服务已重启，请重新打开终端后重试。",
      retryable: true,
    });
  });

  it("keeps a safe network technical detail without exposing a stack", () => {
    const error = toMainAgentError(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
      }),
      { operation: "agent.run" },
    );

    expect(error.code).toBe("NETWORK_UNAVAILABLE");
    expect(error.details).toMatchObject({
      technicalMessage: "TypeError: fetch failed | ECONNRESET | socket closed",
    });
  });

  it("classifies model response conversion TypeErrors as invalid model responses", () => {
    const error = toMainAgentError(
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      { operation: "ipc:model.test_connection" },
    );

    expect(error).toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("classifies model adapters' empty replies as invalid model responses", () => {
    expect(
      toMainAgentError(
        new ModelResponseError("Model did not return a reply."),
        { operation: "ipc:model.test_connection" },
      ),
    ).toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("classifies a LangGraph recursion limit as a controlled model run limit", () => {
    const error = Object.assign(
      new Error('Recursion limit of 25 reached without hitting a stop condition.'),
      { lc_error_code: "GRAPH_RECURSION_LIMIT", name: "GraphRecursionError" },
    );

    expect(toMainAgentError(error, { operation: "agent.run" })).toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("keeps an expired approval separate from a stale file change", () => {
    const expired = Object.assign(new Error("This tool approval is no longer pending."), {
      code: "APPROVAL_EXPIRED",
    });

    expect(toMainAgentError(expired, { operation: "conversation.approve_tool_change" }))
      .toMatchObject({
        code: "APPROVAL_EXPIRED",
        message: "该审批已失效，请查看工具的最新状态。",
        retryable: false,
      });
    expect(toMainAgentError(
      Object.assign(new Error("The file was changed."), { code: "FILE_CHANGED" }),
      { operation: "tool:write_file" },
    ).code).toBe("FILE_CHANGED");
  });

  it("includes a safe field path for schema validation failures", () => {
    const parsed = z.object({
      tasks: z.array(z.object({ title: z.string().min(1) }))
    }).safeParse({ tasks: [{ title: "" }] });
    if (parsed.success) throw new Error("Expected schema validation to fail.");

    const reason: unknown = parsed.error;
    const error = toMainAgentError(reason, { operation: "tool:create_task_list" });

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("字段 tasks.0.title");
  });

  it("classifies structured malformed tool arguments without matching a message string", () => {
    let reason: unknown;
    try {
      parseToolArguments("not-json");
    } catch (error) {
      reason = error;
    }

    expect(toMainAgentError(reason, { operation: "tool:read_file" })).toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
  });

  it("redacts configured and recognizable API keys from user and log text", () => {
    const key = "sk-1234567890abcdefghijkl";
    expect(sanitizeSensitiveText(`Bearer ${key} ${key}`, [key])).not.toContain(key);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reason = new Error(`request failed with ${key}`);
    const error = toMainAgentError(reason, { operation: "agent.run", redactValues: [key] });
    reportMainError(error, reason, [key]);

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(key);
    consoleError.mockRestore();
  });
});
