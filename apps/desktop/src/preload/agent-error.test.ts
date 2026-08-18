import { serializeAgentError } from "@agent/protocol";
import { describe, expect, it } from "vitest";

import { toAgentClientError } from "./agent-error.js";

describe("preload agent errors", () => {
  it("restores a structured main-process error", () => {
    const serialized = serializeAgentError({
      code: "STORAGE_FAILED",
      id: "123e4567-e89b-42d3-a456-426614174000",
      message: "本地数据保存失败，请重试。",
      retryable: true,
    });
    const error = toAgentClientError(new Error(`Error invoking remote method: ${serialized}`));

    expect(error.code).toBe("STORAGE_FAILED");
    expect(error.errorId).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("hides unstructured Electron errors behind an IPC failure", () => {
    const error = toAgentClientError(new Error("Error invoking remote method: internal path"));

    expect(error.code).toBe("IPC_FAILED");
    expect(error.message).not.toContain("internal path");
  });
});
