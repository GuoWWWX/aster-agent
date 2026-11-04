import { describe, expect, it, vi } from "vitest";
import { LangChainModelAdapter } from "./langchain-model-adapter.js";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";

function message(role: ModelMessage["role"], content: string): ModelMessage {
  return { role, content, attachments: [], toolCallId: null, toolCalls: [] };
}

function sse(chunks: string[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(JSON.parse(chunk))}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("ChatGPT plan integration with the model adapter", () => {
  it("preserves a rate-limit error and tells users where to manage their plan", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Rate limit reached", type: "rate_limit_error" } }, { status: 429 }));
    const input: CompleteTurnInput = {
      configuration: { apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "chatgpt-plan",
        modelId: "example-model", reasoningOptions: [], chatGptAccessToken: () => Promise.resolve("oauth-secret") },
      messages: [message("user", "Hello")], maxOutputTokens: 128, onTextDelta: () => undefined,
      reasoning: undefined, signal: AbortSignal.timeout(5_000), tools: [],
    };
    const result = new LangChainModelAdapter("openai-responses", request).completeTurn(input);
    await expect(result).rejects.toHaveProperty("status", 429);
    await expect(result).rejects.toThrow(/管理用量/u);
    await expect(result).rejects.toHaveProperty("retryable", undefined);
  });

  it("classifies the structured HTTP plan-limit code without treating all 429 errors as plan limits", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: {
      code: "subscription_sharing_usage_limit_exceeded", message: "Usage limit reached", type: "rate_limit_error",
    } }, { status: 429 }));
    const input: CompleteTurnInput = {
      configuration: { apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "chatgpt-plan",
        modelId: "example-model", reasoningOptions: [], chatGptAccessToken: () => Promise.resolve("oauth-secret") },
      messages: [message("user", "Hello")], maxOutputTokens: 128, onTextDelta: () => undefined,
      reasoning: undefined, signal: AbortSignal.timeout(5_000), tools: [],
    };
    await expect(new LangChainModelAdapter("openai-responses", request).completeTurn(input))
      .rejects.toHaveProperty("retryable", false);
  });

  it("reports plan usage limits returned after the response stream starts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(sse([
      '{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}',
    ]));
    const input: CompleteTurnInput = {
      configuration: { apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "chatgpt-plan",
        modelId: "example-model", reasoningOptions: [], chatGptAccessToken: () => Promise.resolve("oauth-secret") },
      messages: [message("user", "Hello")], maxOutputTokens: 128, onTextDelta: () => undefined,
      reasoning: undefined, signal: AbortSignal.timeout(5_000), tools: [],
    };
    const result = new LangChainModelAdapter("openai-responses", request).completeTurn(input);
    await expect(result).rejects.toHaveProperty("status", 429);
    await expect(result).rejects.toThrow(/管理用量/u);
    await expect(result).rejects.toHaveProperty("retryable", false);
  });

  it("does not report a successful response when the stream ends before completion", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(sse(['{"type":"response.output_text.delta","delta":"partial"}']));
    const input: CompleteTurnInput = {
      configuration: { apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "chatgpt-plan",
        modelId: "example-model", reasoningOptions: [], chatGptAccessToken: () => Promise.resolve("oauth-secret") },
      messages: [message("user", "Hello")], maxOutputTokens: 128, onTextDelta: () => undefined,
      reasoning: undefined, signal: AbortSignal.timeout(5_000), tools: [],
    };
    await expect(new LangChainModelAdapter("openai-responses", request).completeTurn(input)).rejects.toThrow();
  });

  it("streams function calls and sends tool results in the next supported request", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sse([
        '{"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":""}}',
        '{"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{}"}',
        '{"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":"{}"}}',
        '{"type":"response.completed","response":{"id":"resp_1","model":"example-model","output":[{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":"{}"}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
      ]))
      .mockResolvedValueOnce(sse([
        '{"type":"response.output_text.delta","delta":"Done"}',
        '{"type":"response.completed","response":{"id":"resp_2","model":"example-model","output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done","annotations":[]}]}],"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}',
      ]));
    const input: CompleteTurnInput = {
      configuration: { apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "chatgpt-plan",
        modelId: "example-model", reasoningOptions: [], chatGptAccessToken: () => Promise.resolve("oauth-secret") },
      messages: [message("system", "Follow instructions"), message("user", "Read the file")],
      maxOutputTokens: 128, onTextDelta: () => undefined, reasoning: undefined, signal: AbortSignal.timeout(5_000),
      tools: [{ name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } }],
    };
    const adapter = new LangChainModelAdapter("openai-responses", request);
    const first = await adapter.completeTurn(input);
    expect(first.toolCalls).toEqual([{ name: "read_file", id: "call_1", arguments: "{}" }]);
    const assistant = { ...message("assistant", first.content), toolCalls: first.toolCalls,
      ...(first.providerState === undefined ? {} : { providerState: first.providerState }) };
    const result = { ...message("tool", "File contents"), toolCallId: "call_1" };
    const second = await adapter.completeTurn({ ...input, messages: [...input.messages, assistant, result] });
    expect(second.content).toBe("Done");

    for (const [, init] of request.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-secret");
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      const body: unknown = JSON.parse(init.body);
      expect(body).toMatchObject({ store: false, stream: true });
      const parsed = body as { input: Array<{ type?: string; role?: string; tools?: Array<{ type: string; name: string }> }> };
      expect(parsed.input.find((item) => item.type === "additional_tools")).toMatchObject({ role: "developer" });
      expect(parsed.input.find((item) => item.type === "additional_tools")?.tools?.some((tool) => tool.type === "function" && tool.name === "read_file")).toBe(true);
      expect(body).not.toHaveProperty("max_output_tokens");
      expect(body).not.toHaveProperty("tools");
    }
    const secondRequest = request.mock.calls[1]?.[1]?.body;
    if (typeof secondRequest !== "string") throw new Error("Expected a JSON request body.");
    const secondBody: unknown = JSON.parse(secondRequest);
    const parsed = secondBody as { input: Array<{ type?: string; call_id?: string; output?: string }> };
    expect(parsed.input.find((item) => item.type === "function_call_output")).toMatchObject({ call_id: "call_1", output: "File contents" });
  });
});
