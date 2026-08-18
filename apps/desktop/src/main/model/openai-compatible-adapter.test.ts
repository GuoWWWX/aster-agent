import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleAdapter } from "./openai-compatible-adapter.js";

const configuration = {
  apiKey: "test-key",
  apiFormat: "openai-chat-completions" as const,
  baseUrl: "https://example.test/v1",
  modelId: "test-model",
  reasoningOptions: []
};

function createStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 }
  );
}

describe("OpenAiCompatibleAdapter", () => {
  it("serializes text and image attachments as multimodal user content", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse(["data: [DONE]\n\n"])
    );
    await new OpenAiCompatibleAdapter(request).completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [{
        attachments: [
          {
            content: "[附件 notes.txt]\nfile body",
            contextTokens: 10,
            id: "text-attachment",
            kind: "text",
            mimeType: "text/plain",
            name: "notes.txt",
            projectPath: null,
            readState: "full",
            source: "upload",
            truncated: false
          },
          {
            contextTokens: 1_024,
            data: "aGVsbG8=",
            id: "image-attachment",
            kind: "image",
            mimeType: "image/png",
            name: "pixel.png",
            projectPath: null,
            readState: "full",
            source: "upload",
            truncated: false
          }
        ],
        content: "describe these",
        role: "user",
        toolCallId: null,
        toolCalls: []
      }],
      onTextDelta: () => undefined,
      reasoning: undefined,
      signal: new AbortController().signal,
      tools: []
    });

    const requestBody = request.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    const body = JSON.parse(requestBody) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(body.messages[0]?.content).toEqual([
      { text: "describe these", type: "text" },
      { text: "[附件 notes.txt]\nfile body", type: "text" },
      {
        text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
        type: "text"
      },
      {
        image_url: { url: "data:image/png;base64,aGVsbG8=" },
        type: "image_url"
      }
    ]);
  });

  it("streams text deltas in order", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"choices":[{"delta":{"content":"hel"},"finish_reason":null}]}\n',
        '\ndata: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    const deltas: string[] = [];
    const result = await new OpenAiCompatibleAdapter(request).completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [],
      onTextDelta: (delta) => deltas.push(delta),
      reasoning: { kind: "effort", value: "high" },
      signal: new AbortController().signal,
      tools: []
    });

    expect(deltas).toEqual(["hel", "lo"]);
    const requestInit = request.mock.calls[0]?.[1];
    const requestBody = requestInit?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The model request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      model: "test-model",
      reasoning_effort: "high",
      stream: true
    });
    expect(result).toEqual({
      content: "hello",
      finishReason: "stop",
      toolCalls: []
    });
  });

  it("assembles streamed tool call fragments", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_","arguments":"{\\"pa"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"th\\":\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n"
      ])
    );
    const result = await new OpenAiCompatibleAdapter(request).completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [],
      onTextDelta: () => undefined,
      reasoning: { kind: "effort", value: "medium" },
      signal: new AbortController().signal,
      tools: []
    });

    expect(result.toolCalls).toEqual([
      { arguments: '{"path":"a.txt"}', id: "call_1", name: "read_file" }
    ]);
  });

  it("streams and replays DeepSeek reasoning content around tool calls", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"check "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"files","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n"
      ]))
      .mockResolvedValueOnce(createStreamResponse(["data: [DONE]\n\n"]));
    const adapter = new OpenAiCompatibleAdapter(request);
    const reasoningDeltas: Array<{ delta: string; kind: string; reset: boolean }> = [];
    const first = await adapter.completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [],
      onReasoningDelta: (event) => reasoningDeltas.push(event),
      onTextDelta: () => undefined,
      reasoning: { kind: "effort", value: "high" },
      signal: new AbortController().signal,
      tools: []
    });

    expect(reasoningDeltas).toEqual([
      { delta: "check ", kind: "content", reset: true },
      { delta: "files", kind: "content", reset: false }
    ]);
    expect(first.providerState).toMatchObject({
      apiFormat: "openai-chat-completions",
      payload: { reasoningContent: "check files" }
    });

    await adapter.completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [{
        attachments: [],
        content: first.content,
        providerState: first.providerState!,
        role: "assistant",
        toolCallId: null,
        toolCalls: first.toolCalls
      }],
      onTextDelta: () => undefined,
      reasoning: { kind: "effort", value: "high" },
      signal: new AbortController().signal,
      tools: []
    });
    const secondBody = request.mock.calls[1]?.[1]?.body;
    expect(typeof secondBody).toBe("string");
    if (typeof secondBody !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(secondBody)).toMatchObject({
      messages: [{
        reasoning_content: "check files",
        role: "assistant"
      }]
    });
  });

  it("sends a configured custom reasoning effort", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse(["data: [DONE]\n\n"])
    );
    await new OpenAiCompatibleAdapter(request).completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [],
      onTextDelta: () => undefined,
      reasoning: { kind: "custom_effort", value: "provider-defined" },
      signal: new AbortController().signal,
      tools: []
    });

    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The model request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      reasoning_effort: "provider-defined"
    });
  });

  it("omits reasoning_effort in automatic mode", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse(["data: [DONE]\n\n"])
    );
    await new OpenAiCompatibleAdapter(request).completeTurn({
      configuration,
      maxOutputTokens: 64,
      messages: [],
      onTextDelta: () => undefined,
      reasoning: undefined,
      signal: new AbortController().signal,
      tools: []
    });

    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The model request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).not.toHaveProperty("reasoning_effort");
  });
});
