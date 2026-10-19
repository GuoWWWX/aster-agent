import { expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";
import { LangChainModelAdapter } from "./langchain-model-adapter.js";

const message = (role: ModelMessage["role"], content: string): ModelMessage => ({ role, content, attachments: [], toolCalls: [], toolCallId: null });
function response(): Response {
  return new Response('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"fixture","model":"fixture","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    { headers: { "Content-Type": "text/event-stream" } });
}

it("preserves the real user cache boundary on the Responses wire across rebuilt Runs", async () => {
  const bodies: { input: Record<string, unknown>[]; prompt_cache_key: string; prompt_cache_options?: unknown }[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
    bodies.push(JSON.parse(options.body) as typeof bodies[number]);
    return Promise.resolve(response());
  });
  const adapter = new LangChainModelAdapter("openai-responses", request);
  const history = [message("system", "rules"), ...Array.from({ length: 96 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `saved ${index}`))];
  const user = message("user", "first request");
  const snapshots = (["skills", "directory"] as const).map(runtimeContext => ({ ...message("user", `latest ${runtimeContext}`), runtimeContext }));
  const base: CompleteTurnInput = {
    configuration: { apiFormat: "openai-responses", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] },
    cacheKey: "conversation-fixture", maxOutputTokens: 100, messages: [...history, user, ...snapshots],
    tools: [], onTextDelta: () => {}, reasoning: undefined, signal: new AbortController().signal,
  };
  await adapter.completeTurn(base);
  await adapter.completeTurn({ ...base, messages: [...history, user, message("assistant", "first answer"), message("user", "second request"), ...snapshots] });
  const first = bodies[0]!, second = bodies[1]!;
  const lastUserIndex = first.input.findLastIndex(item => item.role === "user");
  expect(lastUserIndex).toBe(history.length);
  expect(first.input.slice(lastUserIndex + 1).map(item => item.role)).toEqual(["assistant", "assistant"]);
  expect(second.input.slice(0, lastUserIndex + 1)).toEqual(first.input.slice(0, lastUserIndex + 1));
  expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
  expect(first.prompt_cache_options).toBeUndefined();
  expect(base.messages.at(-1)?.role).toBe("user");
});
