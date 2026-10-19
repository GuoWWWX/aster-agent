import { expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";
import { LangChainModelAdapter } from "./langchain-model-adapter.js";

const message = (role: ModelMessage["role"], content: string): ModelMessage => ({ role, content, attachments: [], toolCalls: [], toolCallId: null });
function response(chat: boolean): Response {
  return new Response(chat ? 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    : 'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"fixture","model":"fixture","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    { headers: { "Content-Type": "text/event-stream" } });
}

it.each(["openai-responses", "openai-chat-completions"] as const)("preserves the real user cache boundary on the %s wire across rebuilt Runs", async apiFormat => {
  const chat = apiFormat === "openai-chat-completions";
  const bodies: { input?: Record<string, unknown>[]; messages?: Record<string, unknown>[]; prompt_cache_key: string; prompt_cache_options?: unknown }[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
    bodies.push(JSON.parse(options.body) as typeof bodies[number]);
    return Promise.resolve(response(chat));
  });
  const adapter = new LangChainModelAdapter(apiFormat, request);
  const history = [message("system", "rules"), ...Array.from({ length: 96 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `saved ${index}`))];
  const user = message("user", "first request");
  const snapshots = (["skills", "directory"] as const).map(runtimeContext => ({ ...message("user", `latest ${runtimeContext}`), runtimeContext }));
  const base: CompleteTurnInput = {
    configuration: { apiFormat, apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] },
    cacheKey: "conversation-fixture", maxOutputTokens: 100, messages: [...history, user, ...snapshots],
    tools: [], onTextDelta: () => {}, reasoning: undefined, signal: new AbortController().signal,
  };
  await adapter.completeTurn(base);
  const call = { ...message("assistant", "checking"), toolCalls: [{ id: "read", name: "read_file", arguments: "{}" }] };
  const result = { ...message("tool", "saved evidence"), toolCallId: "read" };
  await adapter.completeTurn({ ...base, messages: [...history, user, ...snapshots, call, result] });
  await adapter.completeTurn({ ...base, messages: [...history, user, call, result, message("assistant", "first answer"), message("user", "second request"), ...snapshots] });
  const first = bodies[0]!, second = bodies[1]!;
  const firstMessages = (chat ? first.messages : first.input)!, secondMessages = (chat ? second.messages : second.input)!;
  const lastUserIndex = firstMessages.findLastIndex(item => item.role === "user");
  expect(lastUserIndex).toBe(history.length);
  expect(firstMessages.slice(lastUserIndex + 1).map(item => item.role)).toEqual(["assistant", "assistant"]);
  expect(secondMessages.slice(0, lastUserIndex + 1)).toEqual(firstMessages.slice(0, lastUserIndex + 1));
  expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
  expect(first.prompt_cache_options).toBeUndefined();
  const toolLoop = (chat ? bodies[1]!.messages : bodies[1]!.input)!;
  const rebuilt = (chat ? bodies[2]!.messages : bodies[2]!.input)!;
  const toolBoundary = toolLoop.findLastIndex(item => item.role === "tool" || item.type === "function_call_output");
  expect(toolBoundary).toBeGreaterThan(lastUserIndex);
  expect(toolLoop.slice(toolBoundary + 1).map(item => item.role)).toEqual(["assistant", "assistant"]);
  expect(rebuilt.slice(0, toolBoundary + 1)).toEqual(toolLoop.slice(0, toolBoundary + 1));
  expect(base.messages.at(-1)?.role).toBe("user");
});

it("keeps Chat reasoning on its real assistant turn after runtime references and parallel tool results", async () => {
  const bodies: { messages: Record<string, unknown>[] }[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
    bodies.push(JSON.parse(options.body) as typeof bodies[number]);
    return Promise.resolve(response(true));
  });
  const configuration: CompleteTurnInput["configuration"] = { apiFormat: "openai-chat-completions", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] };
  const snapshot = { ...message("user", "runtime reference"), runtimeContext: "skills" as const };
  const assistant: ModelMessage = { ...message("assistant", "checking"), toolCalls: ["one", "two"].map(id => ({ id, name: "read_file", arguments: "{}" })),
    providerState: { apiFormat: configuration.apiFormat, baseUrl: configuration.baseUrl, modelId: configuration.modelId,
      payload: { version: 2, additionalKwargs: { reasoning_content: "private reasoning" } } } };
  await new LangChainModelAdapter(configuration.apiFormat, request).completeTurn({ configuration, maxOutputTokens: 100, tools: [], reasoning: undefined,
    signal: new AbortController().signal, onTextDelta: () => {}, messages: [message("user", "request"), snapshot, assistant, snapshot,
      { ...message("tool", "second"), toolCallId: "two" }, { ...message("tool", "first"), toolCallId: "one" }] });
  const messages = bodies[0]!.messages;
  expect(messages.filter(item => item.role === "assistant").map(item => item.reasoning_content)).toEqual(["private reasoning", undefined]);
  const callIndex = messages.findIndex(item => item.tool_calls !== undefined);
  expect(messages.slice(callIndex + 1, callIndex + 3).map(item => item.tool_call_id)).toEqual(["two", "one"]);
  expect(JSON.stringify(messages.filter(item => item.content === "runtime reference"))).not.toContain("private reasoning");
});
