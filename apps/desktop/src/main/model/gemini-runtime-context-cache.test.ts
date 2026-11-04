import { expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";
import { LangChainModelAdapter } from "./langchain-model-adapter.js";

const message = (role: ModelMessage["role"], content: string): ModelMessage => ({ role, content, attachments: [], toolCalls: [], toolCallId: null });

it("preserves Gemini's stable content prefix across rebuilt Runs without foreign cache parameters", async () => {
  const bodies: { contents: unknown[]; systemInstruction?: unknown }[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
    bodies.push(JSON.parse(options.body) as typeof bodies[number]);
    return Promise.resolve(new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
      { headers: { "Content-Type": "text/event-stream" } }));
  });
  const input: CompleteTurnInput = { configuration: { apiFormat: "google-gemini", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1beta", modelId: "fixture", reasoningOptions: [] },
    cacheKey: "aster:fixture", maxOutputTokens: 100, messages: [], tools: [], onTextDelta: () => {}, reasoning: undefined, signal: new AbortController().signal };
  const history = [message("system", "rules"), ...Array.from({ length: 96 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `saved ${index}`))];
  const user = message("user", "first request");
  const snapshot = { ...message("user", "directory revision 1"), runtimeContext: "directory" as const };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request;
  try {
    const adapter = new LangChainModelAdapter("google-gemini", request);
    await adapter.completeTurn({ ...input, messages: [...history, user, snapshot] });
    await adapter.completeTurn({ ...input, messages: [...history, user, message("assistant", "first answer"), message("user", "second request"), { ...snapshot, content: "directory revision 2" }] });
  } finally { globalThis.fetch = originalFetch; }
  const first = bodies[0]!, second = bodies[1]!;
  expect(first.systemInstruction).toEqual(second.systemInstruction);
  expect(second.contents.slice(0, first.contents.length - 1)).toEqual(first.contents.slice(0, -1));
  for (const body of bodies) {
    expect(body).not.toHaveProperty("prompt_cache_key");
    expect(body).not.toHaveProperty("cache_control");
    expect(body).not.toHaveProperty("cachedContent");
  }
  expect(snapshot.role).toBe("user");
});
