import { describe, expect, it } from "vitest";

import {
  AgentClientError,
  formatAgentError,
  parseSerializedAgentError,
  serializeAgentError,
  type AgentError,
} from "./agent-error.js";

const fixture: AgentError = {
  code: "MODEL_PROVIDER_UNAVAILABLE",
  details: { status: 503 },
  id: "123e4567-e89b-42d3-a456-426614174000",
  message: "模型服务暂时不可用，请稍后重试。",
  retryable: true,
};

describe("agent error protocol", () => {
  it("round-trips an error through Electron's decorated rejection message", () => {
    const serialized = serializeAgentError(fixture);
    const parsed = parseSerializedAgentError(
      new Error(`Error invoking remote method 'model:discover': Error: ${serialized}`),
    );

    expect(parsed).toEqual(fixture);
  });

  it("rejects malformed serialized errors", () => {
    expect(parseSerializedAgentError("AGENT_ERROR:not-json")).toBeNull();
    expect(parseSerializedAgentError(new Error("ordinary error"))).toBeNull();
  });

  it("exposes a stable renderer error without an internal stack", () => {
    const error = new AgentClientError(fixture);

    expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.message).toBe(formatAgentError(fixture));
  });
});
