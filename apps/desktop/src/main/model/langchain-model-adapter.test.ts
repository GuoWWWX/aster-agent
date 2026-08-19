import { AIMessageChunk } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import type { ModelApiFormat } from "@agent/protocol";

import type { CompleteTurnInput } from "./model-contracts.js";
import { LangChainModelAdapter, toolDefinitions } from "./langchain-model-adapter.js";

type BoundToolConfig = {
  config?: { tools?: unknown };
  defaultOptions?: { tools?: unknown };
};

function boundToolConfig(value: unknown): BoundToolConfig {
  return value as BoundToolConfig;
}

function inputFor(
  apiFormat: ModelApiFormat = "openai-chat-completions",
  overrides: Partial<CompleteTurnInput> = {},
): CompleteTurnInput {
  return {
    configuration: {
      apiFormat,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      modelId: "test-model",
      reasoningOptions: [],
    },
    maxOutputTokens: 128,
    messages: [{
      attachments: [],
      content: "hello",
      role: "user",
      toolCallId: null,
      toolCalls: [],
    }],
    onTextDelta: () => undefined,
    reasoning: undefined,
    signal: new AbortController().signal,
    tools: [],
    ...overrides,
  };
}

function createStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 },
  );
}

function recordBody(request: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Record<string, unknown> {
  const body = request.mock.calls[index]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON request body.");
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object request body.");
  }
  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function multimodalInput(apiFormat: ModelApiFormat): CompleteTurnInput {
  const input = inputFor(apiFormat);
  const message = input.messages[0];
  if (message === undefined) throw new Error("Expected a user message.");
  message.attachments = [
    {
      content: "attachment text",
      contextTokens: 10,
      id: "text-attachment",
      kind: "text",
      mimeType: "text/plain",
      name: "notes.txt",
      projectPath: null,
      readState: "full",
      source: "upload",
      truncated: false,
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
      truncated: false,
    },
  ];
  return input;
}

function successChunks(apiFormat: ModelApiFormat): string[] {
  if (apiFormat === "openai-chat-completions") {
    return [
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
  }
  if (apiFormat === "openai-responses") {
    return [
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-1","model":"test-model","output":[{"id":"msg-1","type":"message","role":"assistant","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ];
  }
  if (apiFormat === "anthropic-messages") {
    return [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
  }
  return [
    'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n',
  ];
}

describe("LangChainModelAdapter", () => {
  it("uses the provider-neutral OpenAI tool envelope accepted by all LangChain providers", () => {
    const definitions = toolDefinitions([{
      description: "Read a file",
      name: "read_file",
      parameters: { properties: { path: { type: "string" } }, type: "object" },
    }]);
    expect(definitions).toEqual([{
      function: {
        description: "Read a file",
        name: "read_file",
        parameters: { properties: { path: { type: "string" } }, type: "object" },
      },
      type: "function",
    }]);

    const anthropic = new ChatAnthropic({ apiKey: "test-key", maxTokens: 32, model: "claude-test" })
      .bindTools(definitions);
    expect(boundToolConfig(anthropic).config?.tools).toEqual([expect.objectContaining({
      input_schema: { properties: { path: { type: "string" } }, type: "object" },
      name: "read_file",
    })]);

    const google = new ChatGoogleGenerativeAI({ apiKey: "test-key", model: "gemini-test" })
      .bindTools(definitions);
    expect(boundToolConfig(google).config?.tools).toEqual([{
      functionDeclarations: [{
        description: "Read a file",
        name: "read_file",
        parameters: { properties: { path: { type: "string" } }, type: "object" },
      }],
    }]);

    for (const useResponsesApi of [false, true]) {
      const openai = new ChatOpenAI({
        apiKey: "test-key",
        model: "gpt-test",
        useResponsesApi,
      }).bindTools(definitions);
      expect(boundToolConfig(openai).defaultOptions?.tools).toEqual(definitions);
    }
  });

  it.each([
    "openai-chat-completions",
    "openai-responses",
    "anthropic-messages",
    "google-gemini",
  ] as ModelApiFormat[])("serializes multimodal attachments for %s", async (apiFormat) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse(successChunks(apiFormat)));
    const originalFetch = globalThis.fetch;
    if (apiFormat === "google-gemini") globalThis.fetch = request;
    try {
      await new LangChainModelAdapter(apiFormat, request).completeTurn(multimodalInput(apiFormat));
    } finally {
      globalThis.fetch = originalFetch;
    }

    const body = recordBody(request);
    if (apiFormat === "openai-chat-completions") {
      const messages = body.messages;
      if (!isUnknownArray(messages) || !isRecord(messages[0])) throw new Error("Expected OpenAI messages.");
      expect(messages[0].content).toEqual([
        { text: "hello", type: "text" },
        { text: "attachment text", type: "text" },
        {
          text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
          type: "text",
        },
        { image_url: { url: "data:image/png;base64,aGVsbG8=" }, type: "image_url" },
      ]);
      return;
    }
    if (apiFormat === "openai-responses") {
      const input = body.input;
      if (!isUnknownArray(input) || !isRecord(input[0])) throw new Error("Expected Responses input.");
      expect(input[0].content).toEqual([
        { text: "hello", type: "input_text" },
        { text: "attachment text", type: "input_text" },
        {
          text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
          type: "input_text",
        },
        { detail: "auto", image_url: "data:image/png;base64,aGVsbG8=", type: "input_image" },
      ]);
      return;
    }
    if (apiFormat === "anthropic-messages") {
      const messages = body.messages;
      if (!isUnknownArray(messages) || !isRecord(messages[0])) throw new Error("Expected Anthropic messages.");
      expect(messages[0].content).toEqual([
        { text: "hello", type: "text" },
        { text: "attachment text", type: "text" },
        {
          text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
          type: "text",
        },
        {
          source: { data: "aGVsbG8=", media_type: "image/png", type: "base64" },
          type: "image",
        },
      ]);
      return;
    }
    const contents = body.contents;
    if (!isUnknownArray(contents) || !isRecord(contents[0])) throw new Error("Expected Gemini contents.");
    expect(contents[0].parts).toEqual([
      { text: "hello" },
      { text: "attachment text" },
      { text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片" },
      { inlineData: { data: "aGVsbG8=", mimeType: "image/png" } },
    ]);
  });

  it("converts streamed assistant text and preserves provider metadata", async () => {
    const model = new FakeStreamingChatModel({
      sleep: 0,
      chunks: [
        new AIMessageChunk({ content: "hel" }),
        new AIMessageChunk({
          content: "lo",
          additional_kwargs: { provider_marker: "test" },
        }),
      ],
    });
    const deltas: string[] = [];
    const adapter = new LangChainModelAdapter(
      "openai-chat-completions",
      fetch,
      () => model,
    );

    const result = await adapter.completeTurn(inputFor("openai-chat-completions", {
      onTextDelta: (delta) => deltas.push(delta),
    }));

    expect(result.content).toBe("hello");
    expect(deltas).toEqual(["hel", "lo"]);
    expect(result.toolCalls).toEqual([]);
    expect(result.providerState?.payload).toMatchObject({
      additionalKwargs: { provider_marker: "test" },
    });
  });

  it("normalizes LangChain tool calls to the neutral model contract", async () => {
    const model = new FakeStreamingChatModel({
      sleep: 0,
      chunks: [new AIMessageChunk({
        tool_calls: [{
          args: { path: "src/index.ts" },
          id: "call-1",
          name: "read_file",
        }],
      })],
    });
    const adapter = new LangChainModelAdapter(
      "openai-chat-completions",
      fetch,
      () => model,
    );

    const result = await adapter.completeTurn(inputFor("openai-chat-completions", {
      tools: [{
        description: "Read a file",
        name: "read_file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      }],
    }));

    expect(result.toolCalls).toEqual([{
      arguments: JSON.stringify({ path: "src/index.ts" }),
      id: "call-1",
      name: "read_file",
    }]);
  });

  it("preserves multiple tool calls from one assistant turn", async () => {
    const model = new FakeStreamingChatModel({
      sleep: 0,
      chunks: [new AIMessageChunk({
        tool_calls: [
          {
            args: { path: "one.txt" },
            id: "call-one",
            name: "read_file",
          },
          {
            args: { path: "two.txt" },
            id: "call-two",
            name: "read_file",
          },
        ],
      })],
    });
    const adapter = new LangChainModelAdapter(
      "openai-chat-completions",
      fetch,
      () => model,
    );

    const result = await adapter.completeTurn(inputFor("openai-chat-completions", {
      tools: [{
        description: "Read a file",
        name: "read_file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      }],
    }));

    expect(result.toolCalls).toEqual([
      { arguments: JSON.stringify({ path: "one.txt" }), id: "call-one", name: "read_file" },
      { arguments: JSON.stringify({ path: "two.txt" }), id: "call-two", name: "read_file" },
    ]);
  });

  it("sends OpenAI Chat reasoning effort through the compatible request field", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    const adapter = new LangChainModelAdapter("openai-chat-completions", request);

    await adapter.completeTurn(inputFor("openai-chat-completions", {
      configuration: {
        ...inputFor("openai-chat-completions").configuration,
        modelId: "custom-compatible-model",
      },
      reasoning: { kind: "custom_effort", value: "provider-defined" },
    }));

    expect(recordBody(request)).toMatchObject({
      reasoning_effort: "provider-defined",
    });
  });

  it("replays streamed OpenAI Chat reasoning content on the next request", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"hidden "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"thought"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]));
    const adapter = new LangChainModelAdapter("openai-chat-completions", request);
    const first = await adapter.completeTurn(inputFor("openai-chat-completions"));
    if (first.providerState === undefined) throw new Error("Expected OpenAI Chat provider state.");

    await adapter.completeTurn(inputFor("openai-chat-completions", {
      messages: [{
        attachments: [],
        content: first.content,
        providerState: first.providerState,
        role: "assistant",
        toolCallId: null,
        toolCalls: first.toolCalls,
      }],
    }));

    const messages = recordBody(request, 1).messages;
    if (!isUnknownArray(messages)) throw new Error("Expected an OpenAI messages array.");
    expect(messages).toContainEqual(expect.objectContaining({
      reasoning_content: "hidden thought",
      role: "assistant",
    }));
  });

  it("replays OpenAI Chat reasoning from the previous AI SDK provider state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    const adapter = new LangChainModelAdapter("openai-chat-completions", request);

    await adapter.completeTurn(inputFor("openai-chat-completions", {
      messages: [{
        attachments: [],
        content: "",
        providerState: {
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          payload: {
            assistantMessage: {
              content: "",
              role: "assistant",
            },
            openAiChatReasoningContent: "legacy hidden thought",
            version: 1,
          },
        },
        role: "assistant",
        toolCallId: null,
        toolCalls: [],
      }],
    }));

    const messages = recordBody(request).messages;
    if (!isUnknownArray(messages)) throw new Error("Expected an OpenAI messages array.");
    expect(messages).toContainEqual(expect.objectContaining({
      reasoning_content: "legacy hidden thought",
      role: "assistant",
    }));
  });

  it("does not replay provider state from a different model snapshot", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse(successChunks(
      "openai-chat-completions",
    )));

    await new LangChainModelAdapter("openai-chat-completions", request).completeTurn(
      inputFor("openai-chat-completions", {
        messages: [{
          attachments: [],
          content: "previous answer",
          providerState: {
            apiFormat: "openai-chat-completions",
            baseUrl: "https://different.test/v1",
            modelId: "test-model",
            payload: {
              additionalKwargs: { reasoning_content: "must not replay" },
              version: 2,
            },
          },
          role: "assistant",
          toolCallId: null,
          toolCalls: [],
        }],
      }),
    );

    const messages = recordBody(request).messages;
    if (!isUnknownArray(messages)) throw new Error("Expected an OpenAI messages array.");
    const assistant = messages.find((message) => isRecord(message) && message.role === "assistant");
    if (!isRecord(assistant)) throw new Error("Expected an assistant message.");
    expect(assistant).not.toHaveProperty("reasoning_content");
  });

  it("maps Gemini 3 reasoning effort to the provider thinking level", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n',
    ]));
    const input = inputFor("google-gemini", {
      configuration: {
        ...inputFor("google-gemini").configuration,
        modelId: "gemini-3.1-pro-preview",
      },
      reasoning: { kind: "effort", value: "high" },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = request;
    try {
      await new LangChainModelAdapter("google-gemini", request).completeTurn(input);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(recordBody(request)).toMatchObject({
      generationConfig: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" },
      },
    });
  });

  it("does not duplicate a Gemini API version already present in the configured base URL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n',
    ]));
    const input = inputFor("google-gemini", {
      configuration: {
        ...inputFor("google-gemini").configuration,
        baseUrl: "https://example.test/v1beta",
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = request;
    try {
      await new LangChainModelAdapter("google-gemini", request).completeTurn(input);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(request.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1beta/models/test-model:streamGenerateContent?alt=sse",
    );
  });

  it("does not duplicate the Anthropic API version already present in the configured base URL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"done"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const input = inputFor("anthropic-messages", {
      configuration: {
        ...inputFor("anthropic-messages").configuration,
        baseUrl: "https://example.test/gateway/v1",
      },
    });

    await new LangChainModelAdapter("anthropic-messages", request).completeTurn(input);

    expect(request.mock.calls[0]?.[0]).toBe("https://example.test/gateway/v1/messages");
  });

  it("replays OpenAI Responses output items through LangChain metadata", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"type":"response.created","response":{"id":"resp_1","model":"test-model"}}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"Checking files"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Checking files"}]}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_1","model":"test-model","output":[{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Checking files"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"type":"response.completed","response":{"id":"resp_2","model":"test-model","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
      ]));
    const adapter = new LangChainModelAdapter("openai-responses", request);
    const reasoningDeltas: unknown[] = [];
    const textDeltas: string[] = [];
    const first = await adapter.completeTurn(inputFor("openai-responses", {
      onReasoningDelta: (event) => reasoningDeltas.push(event),
      onTextDelta: (delta) => textDeltas.push(delta),
    }));
    if (first.providerState === undefined) throw new Error("Expected Responses provider state.");

    expect(first.content).toBe("");
    expect(textDeltas).toEqual([]);
    expect(reasoningDeltas).toEqual([{
      delta: "Checking files",
      kind: "summary",
      reset: true,
    }]);

    await adapter.completeTurn(inputFor("openai-responses", {
      messages: [{
        attachments: [],
        content: first.content,
        providerState: first.providerState,
        role: "assistant",
        toolCallId: null,
        toolCalls: first.toolCalls,
      }],
    }));

    expect(recordBody(request, 1).input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "rs_1",
        summary: [{ text: "Checking files", type: "summary_text" }],
        type: "reasoning",
      }),
    ]));
  });

  it("assembles streamed OpenAI Responses tool-call arguments", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"apply_patch","arguments":""}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"patch\\":\\"*** Begin"}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":" Patch\\"}"}\n\n',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"arguments":"{\\"patch\\":\\"*** Begin Patch\\"}"}\n\n',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"apply_patch","arguments":"{\\"patch\\":\\"*** Begin Patch\\"}"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_1","model":"test-model","output":[{"id":"fc_1","type":"function_call","call_id":"call_1","name":"apply_patch","arguments":"{\\"patch\\":\\"*** Begin Patch\\"}"}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ]));

    const result = await new LangChainModelAdapter("openai-responses", request)
      .completeTurn(inputFor("openai-responses"));

    expect(result.toolCalls).toEqual([{
      arguments: '{"patch":"*** Begin Patch"}',
      id: "call_1",
      name: "apply_patch",
    }]);
  });

  it.each([
    {
      body: "<!doctype html><html><head><title>proxy.test | 502: Bad gateway</title></head><body>secret gateway body</body></html>",
      expected: "Model request failed (502): Model provider returned an HTML gateway error: proxy.test | 502: Bad gateway",
      status: 502,
    },
    {
      body: JSON.stringify({
        error: {
          message: "Too Many Requests, request id: 6b8e86b3-4a7d-461b-85cf-b9d86b0aede4",
        },
      }),
      expected: "Model request failed (429): Too Many Requests",
      status: 429,
    },
  ])("sanitizes provider errors with status $status", async ({ body, expected, status }) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
      headers: { "Content-Type": body.startsWith("<") ? "text/html" : "application/json" },
      status,
    }));

    await expect(
      new LangChainModelAdapter("openai-responses", request)
        .completeTurn(inputFor("openai-responses")),
    ).rejects.toThrow(expected);
    await expect(
      new LangChainModelAdapter("openai-responses", request)
        .completeTurn(inputFor("openai-responses")),
    ).rejects.not.toThrow("6b8e86b3-4a7d-461b-85cf-b9d86b0aede4");
  });

  it("passes cancellation to the LangChain stream without remapping it", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const stream = vi.fn().mockImplementation((_messages: unknown, options: { signal: AbortSignal }) => (
      new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(abortError), { once: true });
      })
    ));
    const adapter = new LangChainModelAdapter(
      "openai-chat-completions",
      fetch,
      () => ({ stream } as never),
    );

    const completion = adapter.completeTurn(inputFor("openai-chat-completions", {
      signal: controller.signal,
    }));
    controller.abort(abortError);

    await expect(completion).rejects.toBe(abortError);
    expect(stream).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      maxRetries: 0,
      signal: controller.signal,
    }));
  });

  it("replays OpenAI Responses reasoning from the previous AI SDK provider state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"type":"response.completed","response":{"id":"resp_2","model":"test-model","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ]));
    const adapter = new LangChainModelAdapter("openai-responses", request);

    await adapter.completeTurn(inputFor("openai-responses", {
      messages: [{
        attachments: [],
        content: "",
        providerState: {
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          payload: {
            assistantMessage: {
              content: [{
                providerOptions: {
                  openai: {
                    itemId: "rs_legacy",
                    reasoningEncryptedContent: "encrypted-state",
                  },
                },
                text: "Checking legacy files",
                type: "reasoning",
              }],
              role: "assistant",
            },
            version: 1,
          },
        },
        role: "assistant",
        toolCallId: null,
        toolCalls: [],
      }],
    }));

    expect(recordBody(request).input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        encrypted_content: "encrypted-state",
        id: "rs_legacy",
        summary: [{ text: "Checking legacy files", type: "summary_text" }],
        type: "reasoning",
      }),
    ]));
  });

  it("replays Anthropic thinking signatures and tool calls", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"Inspecting ","signature":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"files"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-state"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":1}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-2","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"done"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]));
    const adapter = new LangChainModelAdapter("anthropic-messages", request);
    const configuration = {
      ...inputFor("anthropic-messages").configuration,
      modelId: "claude-sonnet-4-6",
    };
    const reasoningDeltas: unknown[] = [];
    const first = await adapter.completeTurn(inputFor("anthropic-messages", {
      configuration,
      onReasoningDelta: (event) => reasoningDeltas.push(event),
      reasoning: { kind: "token_budget", value: 1_024 },
    }));
    if (first.providerState === undefined) throw new Error("Expected Anthropic provider state.");

    expect(first.content).toBe("");
    expect(reasoningDeltas).toEqual([
      { delta: "Inspecting ", kind: "summary", reset: true },
      { delta: "files", kind: "summary", reset: false },
    ]);

    await adapter.completeTurn(inputFor("anthropic-messages", {
      configuration,
      messages: [{
        attachments: [],
        content: first.content,
        providerState: first.providerState,
        role: "assistant",
        toolCallId: null,
        toolCalls: first.toolCalls,
      }],
      reasoning: { kind: "token_budget", value: 1_024 },
    }));

    const messages = recordBody(request, 1).messages;
    if (!isUnknownArray(messages)) throw new Error("Expected an Anthropic messages array.");
    const assistant = messages.find((message) => isRecord(message) && message.role === "assistant");
    if (!isRecord(assistant)) throw new Error("Expected an assistant message.");
    expect(assistant.role).toBe("assistant");
    if (!isUnknownArray(assistant.content)) throw new Error("Expected assistant content blocks.");
    const thinking = assistant.content.find((block) => isRecord(block) && block.type === "thinking");
    if (!isRecord(thinking)) throw new Error("Expected an Anthropic thinking block.");
    expect(thinking.signature).toBe("signed-state");
    const toolUse = assistant.content.find((block) => isRecord(block) && block.type === "tool_use");
    if (!isRecord(toolUse)) throw new Error("Expected an Anthropic tool-use block.");
    expect(toolUse.id).toBe("tool-1");
    expect(toolUse.name).toBe("read_file");
  });

  it("replays Anthropic thinking from the previous AI SDK provider state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-2","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"done"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const adapter = new LangChainModelAdapter("anthropic-messages", request);
    const configuration = {
      ...inputFor("anthropic-messages").configuration,
      modelId: "claude-sonnet-4-6",
    };

    await adapter.completeTurn(inputFor("anthropic-messages", {
      configuration,
      messages: [
        {
          attachments: [],
          content: "",
          providerState: {
            apiFormat: "anthropic-messages",
            baseUrl: configuration.baseUrl,
            modelId: configuration.modelId,
            payload: {
              assistantMessage: {
                content: [
                  {
                    providerOptions: { anthropic: { signature: "signed-state" } },
                    text: "Inspecting files",
                    type: "reasoning",
                  },
                  {
                    input: { path: "a.txt" },
                    toolCallId: "tool-1",
                    toolName: "read_file",
                    type: "tool-call",
                  },
                ],
                role: "assistant",
              },
              version: 1,
            },
          },
          role: "assistant",
          toolCallId: null,
          toolCalls: [{ arguments: '{"path":"a.txt"}', id: "tool-1", name: "read_file" }],
        },
        {
          attachments: [],
          content: '{"content":"file contents"}',
          role: "tool",
          toolCallId: "tool-1",
          toolCalls: [],
        },
      ],
      reasoning: { kind: "token_budget", value: 1_024 },
    }));

    const messages = recordBody(request).messages;
    if (!isUnknownArray(messages)) throw new Error("Expected an Anthropic messages array.");
    const assistant = messages.find((message) => isRecord(message) && message.role === "assistant");
    if (!isRecord(assistant) || !isUnknownArray(assistant.content)) {
      throw new Error("Expected an Anthropic assistant message.");
    }
    expect(assistant.content).toContainEqual(expect.objectContaining({
      signature: "signed-state",
      thinking: "Inspecting files",
      type: "thinking",
    }));
  });

  it("replays Gemini thought signatures and function calls", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Inspecting files"},{"functionCall":{"id":"call-1","name":"read_file","args":{"path":"a.txt"}},"thoughtSignature":"signed-state"}]},"finishReason":"STOP"}]}\n\n',
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n',
      ]));
    const adapter = new LangChainModelAdapter("google-gemini", request);
    const reasoningDeltas: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = request;
    let first: Awaited<ReturnType<typeof adapter.completeTurn>>;
    try {
      first = await adapter.completeTurn(inputFor("google-gemini", {
        messages: [{
          attachments: [],
          content: "hello",
          role: "user",
          toolCallId: null,
          toolCalls: [],
        }],
        onReasoningDelta: (event) => reasoningDeltas.push(event),
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
    if (first.providerState === undefined) throw new Error("Expected Gemini provider state.");
    expect(first.content).toBe("");
    expect(reasoningDeltas).toEqual([{
      delta: "Inspecting files",
      kind: "content",
      reset: true,
    }]);

    globalThis.fetch = request;
    try {
      await adapter.completeTurn(inputFor("google-gemini", {
        messages: [
          {
            attachments: [],
            content: first.content,
            providerState: first.providerState,
            role: "assistant",
            toolCallId: null,
            toolCalls: first.toolCalls,
          },
          {
            attachments: [],
            content: '{"content":"file contents"}',
            role: "tool",
            toolCallId: "call-1",
            toolCalls: [],
          },
        ],
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }

    const contents = recordBody(request, 1).contents;
    if (!isUnknownArray(contents)) throw new Error("Expected Gemini contents array.");
    const modelContent = contents.find((content) => isRecord(content) && content.role === "model");
    if (!isRecord(modelContent)) throw new Error("Expected a Gemini model content.");
    expect(modelContent.role).toBe("model");
    if (!isUnknownArray(modelContent.parts)) throw new Error("Expected Gemini model parts.");
    const thoughtPart = modelContent.parts.find((part) => isRecord(part) && part.thought === true);
    if (!isRecord(thoughtPart)) throw new Error("Expected a Gemini thought part.");
    expect(thoughtPart.text).toBe("Inspecting files");
    const functionPart = modelContent.parts.find((part) => isRecord(part) && isRecord(part.functionCall));
    if (!isRecord(functionPart) || !isRecord(functionPart.functionCall)) {
      throw new Error("Expected a Gemini function-call part.");
    }
    expect(functionPart.functionCall.name).toBe("read_file");
    expect(functionPart.thoughtSignature).toBe("signed-state");
  });

  it("replays Gemini thought signatures from the previous AI SDK provider state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n',
    ]));
    const adapter = new LangChainModelAdapter("google-gemini", request);
    const messages = [{
      attachments: [],
      content: "",
      providerState: {
        apiFormat: "google-gemini" as const,
        baseUrl: "https://example.test/v1",
        modelId: "test-model",
        payload: {
          assistantMessage: {
            content: [{
              input: { path: "a.txt" },
              providerOptions: { google: { thoughtSignature: "signed-state" } },
              toolCallId: "call-1",
              toolName: "read_file",
              type: "tool-call",
            }],
            role: "assistant",
          },
          version: 1,
        },
      },
      role: "assistant" as const,
      toolCallId: null,
      toolCalls: [{ arguments: '{"path":"a.txt"}', id: "call-1", name: "read_file" }],
    }, {
      attachments: [],
      content: '{"content":"file contents"}',
      role: "tool" as const,
      toolCallId: "call-1",
      toolCalls: [],
    }];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = request;
    try {
      await adapter.completeTurn(inputFor("google-gemini", { messages }));
    } finally {
      globalThis.fetch = originalFetch;
    }

    const contents = recordBody(request).contents;
    if (!isUnknownArray(contents)) throw new Error("Expected Gemini contents.");
    const modelContent = contents.find((content) => isRecord(content) && content.role === "model");
    if (!isRecord(modelContent) || !isUnknownArray(modelContent.parts)) {
      throw new Error("Expected Gemini model parts.");
    }
    expect(modelContent.parts).toContainEqual(expect.objectContaining({
      thoughtSignature: "signed-state",
    }));
  });

  it.each([
    "openai-responses",
    "anthropic-messages",
    "google-gemini",
  ] as ModelApiFormat[])("rejects a mismatched API format for %s", async (apiFormat) => {
    const adapter = new LangChainModelAdapter("openai-chat-completions");
    await expect(adapter.completeTurn(inputFor(apiFormat))).rejects.toThrow(
      `LangChain adapter for openai-chat-completions cannot handle ${apiFormat}.`,
    );
  });
});
