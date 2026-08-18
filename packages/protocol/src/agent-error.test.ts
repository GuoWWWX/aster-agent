import { describe, expect, it } from "vitest";

import {
  AgentClientError,
  formatAgentError,
  parseSerializedAgentError,
  redactErrorIdentifiers,
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
    expect(error.message).not.toContain(fixture.id);
  });

  it("formats safe provider status and detail without exposing a stack", () => {
    const message = formatAgentError({
      ...fixture,
      details: { providerMessage: "upstream unavailable", status: 503 }
    });

    expect(message).toContain("接口错误：HTTP 503：upstream unavailable");
    expect(message).not.toContain("at ");
    expect(message).not.toContain(fixture.id);
  });

  it("removes provider request identifiers from user-facing details", () => {
    expect(redactErrorIdentifiers(
      "upstream rejected request, request id: 6b8e86b3-4a7d-461b-85cf-b9d86b0aede4",
    )).toBe("upstream rejected request");
    expect(formatAgentError({
      ...fixture,
      details: {
        providerMessage: "429 Too Many Requests, request_id=req_abc123",
        status: 429,
      },
    })).not.toContain("req_abc123");
  });

  it("removes identifiers from the stable error message as well", () => {
    const message = formatAgentError({
      ...fixture,
      details: undefined,
      message: "模型请求失败，request_id=req_abc123。",
    });

    expect(message).toBe("模型请求失败。");
    expect(message).not.toContain("req_abc123");
  });
});
