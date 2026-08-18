import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ModelRequestError } from "../model/model-request-error.js";
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
