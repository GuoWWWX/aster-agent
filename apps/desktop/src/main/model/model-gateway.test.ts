import { describe, expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelConfiguration, ModelProviderAdapter } from "./model-contracts.js";

import { ModelGateway } from "./model-gateway.js";

describe("ModelGateway", () => {
  const configuration: ModelConfiguration = { apiKey: "fixture", apiFormat: "openai-responses", baseUrl: "https://provider.invalid/v1", modelId: "configured-model",
    reasoningOptions: [{ kind: "effort", value: "none", enabled: false }, { kind: "effort", value: "medium" }, { kind: "effort", value: "low" }] };
  const backgroundRequest = () => ({ configuration, messages: [], onTextDelta: vi.fn(), signal: new AbortController().signal });
  const request = (): CompleteTurnInput => ({ ...backgroundRequest(), maxOutputTokens: 2000,
    reasoning: { kind: "effort", value: "medium" }, signal: new AbortController().signal, tools: [] });

  it.each(["title", "summary", "approval", "connection_test"] as const)("uses configured background reasoning with no tools for %s", async (purpose) => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({ content: "ok", finishReason: "stop", toolCalls: [] });
    const input = backgroundRequest();
    const gateway = new ModelGateway({ completeTurn });
    await gateway.completeBackgroundTurn({ ...input, purpose });
    const sent = completeTurn.mock.calls[0]![0];
    expect(sent.configuration).toBe(configuration);
    expect(sent.reasoning).toEqual({ kind: "effort", value: "low" });
    expect(sent.tools).toEqual([]);
    expect(sent.maxOutputTokens).toBeGreaterThanOrEqual(1024);
    sent.onTextDelta("stream");
    expect(input.onTextDelta).toHaveBeenCalledWith("stream");
  });

  it("preserves explicit Agent reasoning and rejects unconfigured or disabled options before a provider request", async () => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({ content: "ok", finishReason: "stop", toolCalls: [] });
    const gateway = new ModelGateway({ completeTurn });
    await gateway.completeTurn(request());
    expect(completeTurn.mock.calls[0]![0].reasoning).toEqual({ kind: "effort", value: "medium" });
    await expect(gateway.completeTurn({ ...request(), reasoning: { kind: "effort", value: "none" } })).rejects.toThrow("disabled");
    await expect(gateway.completeTurn({ ...request(), reasoning: { kind: "effort", value: "high" } })).rejects.toThrow("not configured");
    expect(completeTurn).toHaveBeenCalledTimes(1);
  });

  it("reserves explicit thinking budget plus answer space and leaves unconfigured thinking automatic", async () => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({ content: "ok", finishReason: "stop", toolCalls: [] });
    const input = backgroundRequest();
    const gateway = new ModelGateway({ completeTurn });
    await gateway.completeBackgroundTurn({ ...input, purpose: "approval", configuration: { ...configuration, apiFormat: "anthropic-messages", reasoningOptions: [{ kind: "token_budget", value: 4096 }] } });
    expect(completeTurn.mock.calls[0]![0]).toMatchObject({ reasoning: { kind: "token_budget", value: 4096 }, maxOutputTokens: 4224 });
    await gateway.completeBackgroundTurn({ ...input, purpose: "approval", configuration: { ...configuration, reasoningOptions: [] } });
    expect(completeTurn.mock.calls[1]![0]).toMatchObject({ reasoning: undefined, maxOutputTokens: 320 });
  });
  it("rejects tool calls from background tasks while preserving the ordinary Agent tool loop", async () => {
    const toolCalls = [{ id: "call", name: "read_file", arguments: '{"path":"demo.txt"}' }];
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({ content: "", finishReason: "tool_calls", toolCalls });
    const gateway = new ModelGateway({ completeTurn });
    const input = request();
    await expect(gateway.completeBackgroundTurn({ ...backgroundRequest(), purpose: "approval" })).rejects.toThrow("unexpected Agent tool calls");
    expect((await gateway.completeTurn(input)).toolCalls).toEqual(toolCalls);
    const aborted = new AbortController(); aborted.abort();
    await expect(gateway.completeTurn({ ...input, signal: aborted.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(completeTurn).toHaveBeenCalledTimes(2);
  });
  it("delegates a provider request without changing its streaming callbacks", async () => {
    const received: string[] = [];
    const gateway = new ModelGateway({
      completeTurn(input) {
        input.onTextDelta("hello");
        received.push(input.configuration.modelId, input.messages[0]?.content ?? "");
        return Promise.resolve({ content: "hello", finishReason: "stop" as const, toolCalls: [] });
      },
    });
    const result = await gateway.completeTurn({
      configuration: {
        apiKey: "key",
        apiFormat: "openai-chat-completions",
        baseUrl: "https://example.invalid",
        modelId: "test-model",
        reasoningOptions: [],
      },
      maxOutputTokens: 128,
      messages: [{ attachments: [], content: "input", role: "user", toolCallId: null, toolCalls: [] }],
      onTextDelta: (delta) => received.push(delta),
      reasoning: undefined,
      signal: new AbortController().signal,
      tools: [],
    });

    expect(result.content).toBe("hello");
    expect(received).toEqual(["hello", "test-model", "input"]);
  });
});
