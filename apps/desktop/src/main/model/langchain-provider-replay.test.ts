import { describe, expect, it } from "vitest";
import type { CompleteTurnInput, ModelMessage, ModelProviderState } from "./model-contracts.js";
import { matchingProviderState, openAiChatReasoningByAssistant, providerReplayFields } from "./langchain-provider-replay.js";

function state(payload: unknown, apiFormat: ModelProviderState["apiFormat"] = "openai-chat-completions"): ModelProviderState {
  return { apiFormat, baseUrl: "https://example.test/v1", modelId: "model", payload };
}
function assistant(providerState: ModelProviderState): ModelMessage {
  return { attachments: [], content: "visible answer", providerState, role: "assistant", toolCallId: null, toolCalls: [] };
}
function input(messages: ModelMessage[] = []): CompleteTurnInput {
  return { configuration: { apiFormat: "openai-chat-completions", apiKey: "fixture", baseUrl: "https://example.test/v1", modelId: "model", reasoningOptions: [] },
    maxOutputTokens: 100, messages, onTextDelta: () => undefined, reasoning: undefined, signal: new AbortController().signal, tools: [] };
}

describe("LangChain request-side provider replay", () => {
  it.each(["apiFormat", "baseUrl", "modelId"] as const)("rejects replay with a different %s snapshot", field => {
    const snapshot = state({ version: 2, content: "stored" });
    if (field === "apiFormat") snapshot.apiFormat = "openai-responses";
    else snapshot[field] = "different";
    expect(matchingProviderState(assistant(snapshot), input())).toBeNull();
  });

  it("accepts an exact snapshot and preserves its current provider extension blocks", () => {
    const snapshot = state({ version: 2, content: [{ type: "vendor_block", opaque: { encrypted: "secret-state" } }],
      additionalKwargs: { vendor_extra: { signature: "signed" } }, responseMetadata: { id: "response" } });
    const original = structuredClone(snapshot);
    expect(matchingProviderState(assistant(snapshot), input())).toBe(snapshot);
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({
      content: [{ type: "vendor_block", opaque: { encrypted: "secret-state" } }],
      additionalKwargs: { vendor_extra: { signature: "signed" } }, responseMetadata: { id: "response" },
    });
    expect(snapshot).toEqual(original);
  });

  it("keeps current empty values ahead of the previous AI SDK fallback", () => {
    const snapshot = state({ version: 1, content: "", additionalKwargs: {}, responseMetadata: {},
      assistantMessage: { role: "assistant", content: "legacy answer" }, openAiChatReasoningContent: "legacy reasoning" });
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({ content: "", additionalKwargs: {}, responseMetadata: {} });
  });

  it("restores legacy Chat reasoning when the old state has no assistant message", () => {
    expect(providerReplayFields(state({ version: 1, openAiChatReasoningContent: "legacy hidden" }), "openai-chat-completions"))
      .toEqual({ additionalKwargs: { reasoning_content: "legacy hidden" } });
    expect(providerReplayFields(state({ version: 1, openAiChatReasoningContent: "legacy hidden" }), "anthropic-messages"))
      .toEqual({});
  });

  it("restores signed Anthropic thinking from AI SDK v1", () => {
    const snapshot = state({ version: 1, assistantMessage: { role: "assistant", content: [
      { type: "reasoning", text: "thinking", providerOptions: { anthropic: { signature: "signed-thinking" } } },
      { type: "text", text: "answer" },
    ] } }, "anthropic-messages");
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({ content: [
      { type: "thinking", thinking: "thinking", signature: "signed-thinking" }, { type: "text", text: "answer" },
    ] });
  });

  it("restores Gemini thought and function-call signatures from AI SDK v1", () => {
    const snapshot = state({ version: 1, assistantMessage: { role: "assistant", content: [
      { type: "reasoning", text: "thinking", providerOptions: { google: { thoughtSignature: "thought-signed" } } },
      { type: "tool-call", toolCallId: "call", providerOptions: { google: { thoughtSignature: "call-signed" } } },
    ] } }, "google-gemini");
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({
      additionalKwargs: { __gemini_function_call_thought_signatures__: { call: "call-signed" } },
      content: [{ type: "thinking", thinking: "thinking", signature: "thought-signed" }],
    });
  });

  it("keeps encrypted Responses reasoning and summary order from AI SDK v1", () => {
    const snapshot = state({ version: 1, assistantMessage: { role: "assistant", content: [
      { type: "reasoning", text: "first", providerOptions: { openai: { itemId: "reasoning-1", reasoningEncryptedContent: "opaque-encrypted" } } },
      { type: "reasoning", text: "second", providerOptions: { openai: { itemId: "reasoning-2" } } },
    ] } }, "openai-responses");
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({
      additionalKwargs: { reasoning: { id: "reasoning-1", encrypted_content: "opaque-encrypted", type: "reasoning",
        summary: [{ text: "first", type: "summary_text" }, { text: "second", type: "summary_text" }] } },
      content: [{ id: "reasoning-1", reasoning: "first", type: "reasoning" }, { id: "reasoning-2", reasoning: "second", type: "reasoning" }],
    });
  });

  it("retains native Gemini part extensions and per-call signatures", () => {
    const snapshot = state({ parts: [
      { thought: true, text: "thinking", thoughtSignature: "thought-signed", vendorFlag: true },
      { functionCall: { id: "call", name: "read_file", args: {} }, thoughtSignature: "call-signed", vendorFlag: true },
    ] }, "google-gemini");
    expect(providerReplayFields(snapshot, snapshot.apiFormat)).toEqual({
      additionalKwargs: { __gemini_function_call_thought_signatures__: { call: "call-signed" } },
      content: [
        { thought: true, text: "thinking", thoughtSignature: "thought-signed", vendorFlag: true, thinking: "thinking", signature: "thought-signed", type: "thinking" },
        { functionCall: { id: "call", name: "read_file", args: {} }, thoughtSignature: "call-signed", vendorFlag: true, type: "functionCall" },
      ],
    });
  });

  it("restores old Responses output metadata only when current content is absent", () => {
    const outputItems = [{ type: "reasoning", encrypted_content: "opaque-state", vendor_extension: true }];
    expect(providerReplayFields(state({ outputItems }, "openai-responses"), "openai-responses"))
      .toEqual({ responseMetadata: { model_provider: "openai", output: outputItems } });
    expect(providerReplayFields(state({ content: "", outputItems }, "openai-responses"), "openai-responses"))
      .toEqual({ content: "" });
  });

  it("restores native Anthropic content blocks while retaining response extensions", () => {
    const contentBlocks = [{ type: "redacted_thinking", data: "opaque-signed" }];
    expect(providerReplayFields(state({ contentBlocks, responseMetadata: { custom: true } }, "anthropic-messages"), "anthropic-messages"))
      .toEqual({ content: contentBlocks, responseMetadata: { custom: true, model_provider: "anthropic" } });
  });

  it.each([null, "not-a-record", []])("ignores malformed provider payload %j without throwing", payload => {
    expect(providerReplayFields(state(payload), "openai-chat-completions")).toEqual({});
  });

  it("indexes Chat reasoning by assistant messages without shifting on empty or foreign snapshots", () => {
    const first = assistant(state({ version: 2, additionalKwargs: { reasoning_content: "one" } }));
    const empty = assistant(state({ version: 2, additionalKwargs: { reasoning_content: "" } }));
    const foreign = assistant({ ...state({ version: 2, additionalKwargs: { reasoning_content: "foreign" } }), modelId: "different" });
    const user: ModelMessage = { attachments: [], content: "next", role: "user", toolCallId: null, toolCalls: [] };
    expect(openAiChatReasoningByAssistant(input([first, user, empty, foreign]))).toEqual(["one", null, null]);
    const snapshot = { ...user, runtimeContext: "skills" as const };
    expect(openAiChatReasoningByAssistant(input([snapshot, first, user, snapshot, empty, foreign]))).toEqual(["one", null, null, null]);
  });
});
