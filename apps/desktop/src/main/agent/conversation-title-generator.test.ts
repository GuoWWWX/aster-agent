import { describe, expect, it, vi } from "vitest";
import type { ModelConfiguration, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ConversationTitleGenerator } from "./conversation-title-generator.js";

const configuration: ModelConfiguration = { apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid",
  modelId: "selected-model", reasoningOptions: [{ kind: "effort", value: "high" }, { kind: "effort", value: "none", enabled: false }, { kind: "effort", value: "minimal" }] };
const reply = (content: string): ModelTurnResult => ({ content, finishReason: "stop", toolCalls: [] });
const input = () => ({ configuration, conversationId: crypto.randomUUID(), content: "请制作登录页面", signal: new AbortController().signal });

describe("conversation title generation", () => {
  it.each(["completed", "end_turn", "STOP", null])("accepts a usable title across provider finish metadata (%s)", async finishReason => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({ ...reply("登录验收"), finishReason });
    expect(await new ConversationTitleGenerator({ completeTurn }).generate(input())).toBe("登录验收");
    expect(completeTurn).toHaveBeenCalledTimes(1);
  });
  it("uses the selected model's lowest enabled reasoning with no tools or conversation history", async () => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue(reply('“登录页面设计…”'));
    expect(await new ConversationTitleGenerator({ completeTurn }).generate(input())).toBe("登录页面设计");
    const request = completeTurn.mock.calls[0]![0];
    expect(request.configuration).toBe(configuration);
    expect(request.reasoning).toEqual({ kind: "effort", value: "minimal" });
    expect(request.tools).toEqual([]); expect(request.messages).toHaveLength(2);
    expect(JSON.parse(request.messages[1]!.content)).toEqual({ firstMessage: "请制作登录页面" });
    expect(request.cacheKey).toMatch(/^aster:title:/u);
  });
  it.each(["fetch failed", "empty", "tool"])("retries one failed or unusable response once (%s)", async failure => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>();
    if (failure === "fetch failed") completeTurn.mockRejectedValueOnce(new Error(failure));
    else completeTurn.mockResolvedValueOnce(failure === "empty" ? reply("") : { ...reply("不执行"), finishReason: "tool_calls", toolCalls: [{ id: "x", name: "run_command", arguments: "{}" }] });
    completeTurn.mockResolvedValueOnce(reply("登录验收"));
    expect(await new ConversationTitleGenerator({ completeTurn }).generate(input())).toBe("登录验收");
    expect(completeTurn).toHaveBeenCalledTimes(2);
  });
  it("stops after two failures", async () => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockRejectedValue(new Error("fetch failed"));
    await expect(new ConversationTitleGenerator({ completeTurn }).generate(input())).rejects.toThrow("fetch failed");
    expect(completeTurn).toHaveBeenCalledTimes(2);
  });
  it("does not retry cancelled naming requests", async () => {
    const controller = new AbortController();
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockImplementation(() => { controller.abort(); return Promise.reject(new DOMException("cancelled", "AbortError")); });
    await expect(new ConversationTitleGenerator({ completeTurn }).generate({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(completeTurn).toHaveBeenCalledTimes(1);
  });
  it("limits Unicode titles to twenty characters", async () => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue(reply("😀".repeat(30)));
    expect(await new ConversationTitleGenerator({ completeTurn }).generate(input())).toBe("😀".repeat(20));
  });
  it.each([false, true])("uses the minimum explicit token budget or leaves unsupported reasoning unset (%s)", async budget => {
    const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue(reply("登录验收"));
    await new ConversationTitleGenerator({ completeTurn }).generate({ ...input(), configuration: { ...configuration,
      apiFormat: "google-gemini", reasoningOptions: budget ? [{ kind: "token_budget", value: -1 }, { kind: "token_budget", value: 4096 }, { kind: "token_budget", value: 0 }] : [] } });
    expect(completeTurn.mock.calls[0]![0].reasoning).toEqual(budget ? { kind: "token_budget", value: 0 } : undefined);
  });
});
