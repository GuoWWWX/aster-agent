import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { CompleteTurnInput, ModelMessage, ModelMessageAttachment } from "./model-contracts.js";
import { toLangChainMessages } from "./langchain-model-messages.js";

function message(role: ModelMessage["role"], content: string): ModelMessage {
  return { attachments: [], content, role, toolCallId: null, toolCalls: [] };
}
function input(apiFormat: CompleteTurnInput["configuration"]["apiFormat"] = "openai-chat-completions"): CompleteTurnInput {
  return { configuration: { apiFormat, apiKey: "fixture", baseUrl: "https://example.test/v1", modelId: "model", reasoningOptions: [] },
    maxOutputTokens: 100, messages: [], onTextDelta: () => undefined, reasoning: undefined, signal: new AbortController().signal, tools: [] };
}
function image(id: string, source: ModelMessageAttachment["source"], data: string | null): ModelMessageAttachment {
  return { contextTokens: 1, data, id, kind: "image", mimeType: "image/png", name: `${id}.png`, projectPath: null,
    readPath: `attachments/${id}.png`, readState: "preview", source, truncated: false };
}

describe("LangChain model message conversion", () => {
  it("maps all four roles and parses neutral tool arguments", () => {
    const assistant = message("assistant", "checking");
    assistant.toolCalls = [{ id: "call", name: "read_file", arguments: '{"path":"demo.txt"}' }];
    const tool = { ...message("tool", "evidence"), toolCallId: "call" };
    const converted = toLangChainMessages([message("system", "rules"), message("user", "request"), assistant, tool], input());
    expect(converted[0]).toBeInstanceOf(SystemMessage);
    expect(converted[1]).toBeInstanceOf(HumanMessage);
    expect(converted[2]).toBeInstanceOf(AIMessage);
    expect(converted[3]).toBeInstanceOf(ToolMessage);
    const ai = converted[2], result = converted[3];
    if (!(ai instanceof AIMessage) || !(result instanceof ToolMessage)) throw new Error("Expected converted tool messages");
    expect(ai.tool_calls).toEqual([{ args: { path: "demo.txt" }, id: "call", name: "read_file" }]);
    expect(result.tool_call_id).toBe("call");
  });

  it("keeps user text, text attachments and image captions together without modifying sources", () => {
    const user = message("user", "describe");
    user.attachments = [{ content: "attached notes", contextTokens: 1, id: "notes", kind: "text", mimeType: "text/plain",
      name: "notes.txt", projectPath: null, readState: "full", source: "upload", truncated: false }, image("pixel", "upload", "IMAGE_BYTES")];
    const original = structuredClone(user);
    const converted = toLangChainMessages([user], input());
    const content = JSON.stringify(converted[0]?.content);
    expect(content).toContain("describe");
    expect(content).toContain("attached notes");
    expect(content).toContain("attachment_id: pixel");
    expect(content).toContain("attachments/pixel.png");
    expect(content).toContain("IMAGE_BYTES");
    expect(user).toEqual(original);
  });

  it("fails when current image data was not loaded instead of silently omitting the image", () => {
    const user = { ...message("user", "describe"), attachments: [image("missing", "upload", null)] };
    expect(() => toLangChainMessages([user], input())).toThrow("Image attachment missing.png was not loaded.");
  });

  it.each(["openai-chat-completions", "openai-responses"] as const)("keeps Tool results adjacent before interleaved input for %s", apiFormat => {
    const assistant = message("assistant", "dispatch");
    assistant.toolCalls = ["one", "two"].map(id => ({ id, name: "read_file", arguments: "{}" }));
    const messages = [assistant, message("user", "steer"), { ...message("tool", "second"), toolCallId: "two" },
      { ...message("tool", "first"), toolCallId: "one" }, message("user", "next")];
    const original = structuredClone(messages);
    expect(toLangChainMessages(messages, input(apiFormat)).map(item => item.content)).toEqual(["dispatch", "second", "first", "steer", "next"]);
    expect(messages).toEqual(original);
  });

  it.each(["anthropic-messages", "google-gemini"] as const)("preserves neutral message order for %s", apiFormat => {
    const assistant = message("assistant", "dispatch");
    assistant.toolCalls = [{ id: "call", name: "read_file", arguments: "{}" }];
    const messages = [assistant, message("user", "steer"), { ...message("tool", "evidence"), toolCallId: "call" }];
    expect(toLangChainMessages(messages, input(apiFormat)).map(item => item.content)).toEqual(["dispatch", "steer", "evidence"]);
  });

  it("replaces only older browser/computer screenshot bytes while keeping latest and user images", () => {
    const messages = [
      { ...message("user", "old browser"), attachments: [image("old-browser", "browser", "OLD_BROWSER_BYTES")] },
      { ...message("user", "old computer"), attachments: [image("old-computer", "computer", "OLD_COMPUTER_BYTES")] },
      { ...message("user", "uploaded"), attachments: [image("uploaded", "upload", "KEEP_UPLOADED_BYTES")] },
      { ...message("user", "new browser"), attachments: [image("new-browser-1", "browser", "NEW_BROWSER_ONE"), image("new-browser-2", "browser", "NEW_BROWSER_TWO")] },
      { ...message("user", "new computer"), attachments: [image("new-computer", "computer", "NEW_COMPUTER_BYTES")] },
    ];
    const original = structuredClone(messages);
    const content = JSON.stringify(toLangChainMessages(messages, input()).map(item => item.content));
    expect(content).not.toContain("OLD_BROWSER_BYTES");
    expect(content).not.toContain("OLD_COMPUTER_BYTES");
    for (const bytes of ["KEEP_UPLOADED_BYTES", "NEW_BROWSER_ONE", "NEW_BROWSER_TWO", "NEW_COMPUTER_BYTES"]) expect(content).toContain(bytes);
    expect(content).toContain("Earlier browser screenshot superseded");
    expect(content).toContain("Earlier computer screenshot superseded");
    expect(messages).toEqual(original);
  });

  it("uses matching provider blocks while retaining visible content for a foreign snapshot", () => {
    const assistant = { ...message("assistant", "visible fallback"), providerState: {
      apiFormat: "openai-chat-completions" as const, baseUrl: "https://example.test/v1", modelId: "model",
      payload: { version: 2, content: [{ type: "vendor_block", encrypted: "opaque" }], additionalKwargs: { extension: true } },
    } };
    const matched = toLangChainMessages([assistant], input());
    expect(matched[0]?.content).toEqual([{ type: "vendor_block", encrypted: "opaque" }]);
    expect(matched[0]?.additional_kwargs).toEqual({ extension: true });
    assistant.providerState.modelId = "foreign";
    expect(toLangChainMessages([assistant], input())[0]?.content).toBe("visible fallback");
  });

  it.each([null, "", "   "])("rejects missing Tool Call identity %j", toolCallId => {
    expect(() => toLangChainMessages([{ ...message("tool", "result"), toolCallId }], input()))
      .toThrow("Tool result does not match a preceding model tool call.");
  });

  it.each(["[]", "invalid json"])("rejects invalid Assistant tool arguments %s", argumentsText => {
    const assistant = message("assistant", "checking");
    assistant.toolCalls = [{ id: "call", name: "read_file", arguments: argumentsText }];
    expect(() => toLangChainMessages([assistant], input())).toThrow();
  });
});
