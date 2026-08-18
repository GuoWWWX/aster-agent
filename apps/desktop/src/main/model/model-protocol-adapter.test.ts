import { describe, expect, it, vi } from "vitest";

import { ModelAdapterRegistry } from "./model-adapter-registry.js";
import type { CompleteTurnInput } from "./model-contracts.js";

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

function inputFor(
  apiFormat: CompleteTurnInput["configuration"]["apiFormat"]
): CompleteTurnInput {
  return {
    configuration: {
      apiKey: "test-key",
      apiFormat,
      baseUrl: "https://example.test/v1",
      modelId: apiFormat === "google-gemini" ? "gemini-2.5-pro" : "test-model",
      reasoningOptions: []
    },
    maxOutputTokens: 64,
    messages: [{
      attachments: [],
      content: "hello",
      role: "user",
      toolCallId: null,
      toolCalls: []
    }],
    onTextDelta: () => undefined,
    reasoning: { kind: "effort", value: "high" },
    signal: new AbortController().signal,
    tools: [{
      description: "Read one file",
      name: "read_file",
      parameters: { type: "object" }
    }]
  };
}

describe("ModelAdapterRegistry", () => {
  it.each([
    {
      apiFormat: "openai-responses" as const,
      chunks: ['data: {"type":"response.completed"}\n\n'],
      verify: (body: Record<string, unknown>) => {
        const input = body.input as Array<{ content: Array<Record<string, unknown>> }>;
        expect(input[0]?.content).toEqual([
          { text: "hello", type: "input_text" },
          { text: "attachment text", type: "input_text" },
          {
            text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
            type: "input_text"
          },
          { image_url: "data:image/png;base64,aGVsbG8=", type: "input_image" }
        ]);
      }
    },
    {
      apiFormat: "anthropic-messages" as const,
      chunks: ['data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'],
      verify: (body: Record<string, unknown>) => {
        const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
        expect(messages[0]?.content).toEqual([
          { text: "hello", type: "text" },
          { text: "attachment text", type: "text" },
          {
            text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片",
            type: "text"
          },
          {
            source: { data: "aGVsbG8=", media_type: "image/png", type: "base64" },
            type: "image"
          }
        ]);
      }
    },
    {
      apiFormat: "google-gemini" as const,
      chunks: ['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n'],
      verify: (body: Record<string, unknown>) => {
        const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
        expect(contents[0]?.parts).toEqual([
          { text: "hello" },
          { text: "attachment text" },
          {
            text: "[图片附件 pixel.png]\nattachment_id: image-attachment\nsource: 用户上传图片"
          },
          { inlineData: { data: "aGVsbG8=", mimeType: "image/png" } }
        ]);
      }
    }
  ])("serializes attachments for $apiFormat", async ({ apiFormat, chunks, verify }) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse(chunks));
    const input = inputFor(apiFormat);
    input.messages[0]!.attachments = [
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
    ];

    await new ModelAdapterRegistry(request).completeTurn(input);

    const requestBody = request.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    verify(body);
  });

  it("uses the OpenAI Responses endpoint and parses output text", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"response.output_text.delta","delta":"hello"}\n\n',
        'data: {"type":"response.completed"}\n\n'
      ])
    );
    const result = await new ModelAdapterRegistry(request).completeTurn(
      inputFor("openai-responses")
    );

    expect(request.mock.calls[0]?.[0]).toBe("https://example.test/v1/responses");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer test-key"
    });
    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The Responses request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      model: "test-model",
      reasoning: { effort: "high", summary: "auto" },
      stream: true
    });
    expect(result).toMatchObject({ content: "hello", finishReason: "completed" });
  });

  it("uses the final Responses message when a provider omits text deltas", async () => {
    const deltas: string[] = [];
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"final answer"}]}}\n\n',
        'data: {"type":"response.completed"}\n\n'
      ])
    );

    const result = await new ModelAdapterRegistry(request).completeTurn({
      ...inputFor("openai-responses"),
      onTextDelta: (delta) => deltas.push(delta)
    });

    expect(result).toMatchObject({ content: "final answer", finishReason: "completed" });
    expect(deltas).toEqual(["final answer"]);
  });

  it("sends a configured custom reasoning effort to Responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse(['data: {"type":"response.completed"}\n\n'])
    );
    await new ModelAdapterRegistry(request).completeTurn({
      ...inputFor("openai-responses"),
      reasoning: { kind: "custom_effort", value: "provider-defined" }
    });

    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The Responses request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      reasoning: { effort: "provider-defined" }
    });
  });

  it("parses Responses streams that use event headers without blank separators", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n',
        'event: response.completed\ndata: {"type":"response.completed"}\n'
      ])
    );

    const result = await new ModelAdapterRegistry(request).completeTurn(
      inputFor("openai-responses")
    );

    expect(result).toMatchObject({ content: "hello", finishReason: "completed" });
  });

  it("merges OpenAI Responses streaming tool-call events into one complete call", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"apply_patch","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"patch\\":\\"*** Begin"}\n\n',
        'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"patch\\":\\"*** Begin Patch\\"}"}\n\n',
        'data: {"type":"response.output_item.done","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"apply_patch","arguments":"{\\"patch\\":\\"*** Begin Patch\\"}"}}\n\n',
        'data: {"type":"response.completed"}\n\n'
      ])
    );

    const result = await new ModelAdapterRegistry(request).completeTurn(
      inputFor("openai-responses")
    );

    expect(result).toEqual({
      content: "",
      finishReason: "completed",
      providerState: {
        apiFormat: "openai-responses",
        baseUrl: "https://example.test/v1",
        modelId: "test-model",
        payload: {
          outputItems: [{
            arguments: '{"patch":"*** Begin Patch"}',
            call_id: "call_1",
            id: "fc_1",
            name: "apply_patch",
            type: "function_call"
          }]
        }
      },
      toolCalls: [{
        arguments: '{"patch":"*** Begin Patch"}',
        id: "call_1",
        name: "apply_patch"
      }]
    });
  });

  it("normalizes and replays OpenAI reasoning summaries", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"Checking "}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"files"}\n\n',
        'data: {"type":"response.output_item.done","item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Checking files"}]}}\n\n',
        'data: {"type":"response.completed"}\n\n'
      ]))
      .mockResolvedValueOnce(createStreamResponse(['data: {"type":"response.completed"}\n\n']));
    const adapter = new ModelAdapterRegistry(request);
    const deltas: Array<{ delta: string; kind: string; reset: boolean }> = [];
    const first = await adapter.completeTurn({
      ...inputFor("openai-responses"),
      onReasoningDelta: (event) => deltas.push(event)
    });

    expect(deltas).toEqual([
      { delta: "Checking ", kind: "summary", reset: true },
      { delta: "files", kind: "summary", reset: false }
    ]);
    expect(first.providerState).toMatchObject({
      payload: { outputItems: [{ id: "rs_1", type: "reasoning" }] }
    });

    await adapter.completeTurn({
      ...inputFor("openai-responses"),
      messages: [{
        attachments: [],
        content: "",
        providerState: first.providerState!,
        role: "assistant",
        toolCallId: null,
        toolCalls: []
      }]
    });
    const requestBody = request.mock.calls[1]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(requestBody)).toMatchObject({ input: [{
        id: "rs_1",
        summary: [{ text: "Checking files", type: "summary_text" }],
        type: "reasoning"
      }]
    });
  });

  it("normalizes DeepSeek Responses reasoning text", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"type":"response.reasoning_text.delta","item_id":"rs_1","delta":"Inspecting"}\n\n',
      'data: {"type":"response.completed"}\n\n'
    ]));
    const deltas: unknown[] = [];

    await new ModelAdapterRegistry(request).completeTurn({
      ...inputFor("openai-responses"),
      onReasoningDelta: (event) => deltas.push(event)
    });

    expect(deltas).toEqual([
      { delta: "Inspecting", kind: "content", reset: true }
    ]);
  });

  it("rejects a Responses tool call whose name is blank after normalization", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":" ","arguments":"{}"}}\n\n',
        'data: {"type":"response.completed"}\n\n'
      ])
    );

    await expect(
      new ModelAdapterRegistry(request).completeTurn(inputFor("openai-responses"))
    ).rejects.toThrow("Model returned an incomplete tool call.");
  });

  it("summarizes HTML gateway failures instead of exposing the whole error page", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        "<!doctype html><html><head><title>hththt.top | 502: Bad gateway</title></head><body>gateway body</body></html>",
        { headers: { "Content-Type": "text/html" }, status: 502 }
      )
    );

    await expect(
      new ModelAdapterRegistry(request).completeTurn(inputFor("openai-responses"))
    ).rejects.toThrow(
      "Model request failed (502): Model provider returned an HTML gateway error: hththt.top | 502: Bad gateway"
    );
  });

  it("uses Anthropic headers and assembles tool use arguments", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      createStreamResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n'
      ])
    );
    const result = await new ModelAdapterRegistry(request).completeTurn({
      ...inputFor("anthropic-messages"),
      reasoning: { kind: "token_budget", value: 1_024 }
    });

    expect(request.mock.calls[0]?.[0]).toBe("https://example.test/v1/messages");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
      "x-api-key": "test-key"
    });
    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The Anthropic request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      thinking: { budget_tokens: 1_024, type: "enabled" }
    });
    expect(result).toEqual({
      content: "",
      finishReason: "tool_use",
      providerState: {
        apiFormat: "anthropic-messages",
        baseUrl: "https://example.test/v1",
        modelId: "test-model",
        payload: {
          contentBlocks: [{
            id: "tool-1",
            input: { path: "a.txt" },
            name: "read_file",
            type: "tool_use"
          }]
        }
      },
      toolCalls: [{ arguments: '{"path":"a.txt"}', id: "tool-1", name: "read_file" }]
    });
  });

  it("streams and replays Claude summarized thinking with its signature", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Inspecting "}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"files"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-state"}}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n'
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
      ]));
    const adapter = new ModelAdapterRegistry(request);
    const deltas: unknown[] = [];
    const configuration = {
      ...inputFor("anthropic-messages").configuration,
      modelId: "claude-sonnet-4-6"
    };
    const first = await adapter.completeTurn({
      ...inputFor("anthropic-messages"),
      configuration,
      onReasoningDelta: (event) => deltas.push(event),
      reasoning: { kind: "token_budget", value: 1_024 }
    });

    expect(deltas).toEqual([
      { delta: "Inspecting ", kind: "summary", reset: true },
      { delta: "files", kind: "summary", reset: false }
    ]);
    expect(first.providerState).toMatchObject({
      payload: {
        contentBlocks: [
          { signature: "signed-state", thinking: "Inspecting files", type: "thinking" },
          { input: { path: "a.txt" }, type: "tool_use" }
        ]
      }
    });

    await adapter.completeTurn({
      ...inputFor("anthropic-messages"),
      configuration,
      messages: [{
        attachments: [],
        content: "",
        providerState: first.providerState!,
        role: "assistant",
        toolCallId: null,
        toolCalls: first.toolCalls
      }],
      reasoning: { kind: "token_budget", value: 1_024 }
    });
    const requestBody = request.mock.calls[1]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(requestBody)).toMatchObject({
      messages: [{
        content: [
          { signature: "signed-state", thinking: "Inspecting files", type: "thinking" },
          { id: "tool-1", input: { path: "a.txt" }, name: "read_file", type: "tool_use" }
        ],
        role: "assistant"
      }],
      thinking: { budget_tokens: 1_024, display: "summarized", type: "enabled" }
    });
  });

  it("streams and replays Gemini thought summaries with signed function calls", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Inspecting "}]} }]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"files"},{"functionCall":{"id":"call-1","name":"read_file","args":{"path":"a.txt"}},"thoughtSignature":"signed-state"}]},"finishReason":"STOP"}]}\n\n'
      ]))
      .mockResolvedValueOnce(createStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n'
      ]));
    const adapter = new ModelAdapterRegistry(request);
    const deltas: unknown[] = [];
    const first = await adapter.completeTurn({
      ...inputFor("google-gemini"),
      onReasoningDelta: (event) => deltas.push(event),
      reasoning: { kind: "token_budget", value: 4_096 }
    });

    expect(request.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
    );
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-goog-api-key": "test-key"
    });
    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") {
      throw new Error("The Gemini request body was not serialized as JSON.");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      generationConfig: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: 4_096 }
      }
    });
    expect(deltas).toEqual([
      { delta: "Inspecting ", kind: "summary", reset: true },
      { delta: "files", kind: "summary", reset: false }
    ]);
    expect(first).toEqual({
      content: "",
      finishReason: "STOP",
      providerState: {
        apiFormat: "google-gemini",
        baseUrl: "https://example.test/v1",
        modelId: "gemini-2.5-pro",
        payload: {
          parts: [
            { text: "Inspecting ", thought: true },
            { text: "files", thought: true },
            {
              functionCall: {
                args: { path: "a.txt" },
                id: "call-1",
                name: "read_file"
              },
              thoughtSignature: "signed-state"
            }
          ]
        }
      },
      toolCalls: [{ arguments: '{"path":"a.txt"}', id: "call-1", name: "read_file" }]
    });

    await adapter.completeTurn({
      ...inputFor("google-gemini"),
      messages: [
        {
          attachments: [],
          content: "",
          providerState: first.providerState!,
          role: "assistant",
          toolCallId: null,
          toolCalls: first.toolCalls
        },
        {
          attachments: [],
          content: '{"content":"file contents"}',
          role: "tool",
          toolCallId: "call-1",
          toolCalls: []
        }
      ],
      reasoning: { kind: "token_budget", value: 4_096 }
    });
    const continuationBody = request.mock.calls[1]?.[1]?.body;
    expect(typeof continuationBody).toBe("string");
    if (typeof continuationBody !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(continuationBody)).toMatchObject({ contents: [{
        parts: [
          { text: "Inspecting ", thought: true },
          { text: "files", thought: true },
          {
            functionCall: {
              args: { path: "a.txt" },
              id: "call-1",
              name: "read_file"
            },
            thoughtSignature: "signed-state"
          }
        ],
        role: "model"
      }, {
        parts: [{
          functionResponse: {
            id: "call-1",
            name: "read_file",
            response: { content: '{"content":"file contents"}' }
          }
        }],
        role: "user"
      }]
    });
  });

  it("uses thinking levels for Gemini 3 models", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(createStreamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n\n'
    ]));
    const input = inputFor("google-gemini");
    input.configuration.modelId = "gemini-3.1-pro-preview";
    input.reasoning = { kind: "effort", value: "high" };

    await new ModelAdapterRegistry(request).completeTurn(input);

    const requestBody = request.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    expect(JSON.parse(requestBody)).toMatchObject({
      generationConfig: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" }
      }
    });
  });
});
