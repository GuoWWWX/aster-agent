import { expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";
import { LangChainModelAdapter } from "./langchain-model-adapter.js";

const message = (role: ModelMessage["role"], content: string): ModelMessage => ({ role, content, attachments: [], toolCalls: [], toolCallId: null });
type Block = { type: string; text?: string; content?: unknown; tool_use_id?: string; cache_control?: unknown };
type Body = { system: Block[]; messages: { role: string; content: Block[] | string }[]; cache_control?: unknown };
function fixture() {
  const bodies: Body[] = [];
  const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
    if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
    bodies.push(JSON.parse(options.body) as Body);
    return Promise.resolve(new Response('event: message_start\ndata: {"type":"message_start","message":{"id":"fixture","type":"message","role":"assistant","content":[],"model":"fixture","usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
      { headers: { "Content-Type": "text/event-stream" } }));
  });
  const base: CompleteTurnInput = { configuration: { apiFormat: "anthropic-messages", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] },
    cacheKey: "aster:fixture", maxOutputTokens: 100, messages: [], tools: [], onTextDelta: () => {}, reasoning: undefined, signal: new AbortController().signal };
  return { base, bodies, adapter: new LangChainModelAdapter("anthropic-messages", request) };
}
const blocks = (body: Body) => body.messages.flatMap(entry => typeof entry.content === "string" ? [{ type: "text", text: entry.content }] : entry.content);

it("marks stable Anthropic system and real user blocks, leaving rebuilt runtime snapshots uncached", async () => {
  const { base, bodies, adapter } = fixture();
  const history = [message("system", "rules"), message("user", "saved request"), message("assistant", "saved answer")];
  const user = message("user", "first request");
  const snapshot = { ...message("user", "directory revision 1"), runtimeContext: "directory" as const };
  await adapter.completeTurn({ ...base, messages: [...history, user, snapshot] });
  const call = { ...message("assistant", ""), toolCalls: [{ id: "read", name: "read_file", arguments: "{}" }] };
  const result = { ...message("tool", "saved evidence"), toolCallId: "read" };
  await adapter.completeTurn({ ...base, messages: [...history, user, snapshot, call, result] });
  await adapter.completeTurn({ ...base, messages: [...history, user, call, result, message("assistant", "first answer"), message("user", "second request"), { ...snapshot, content: "directory revision 2" }] });
  const first = bodies[0]!, second = bodies[2]!;
  expect(first.system).toEqual([{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }]);
  expect(blocks(first).filter(block => block.cache_control !== undefined)).toEqual([{ type: "text", text: "first request", cache_control: { type: "ephemeral" } }]);
  expect(blocks(second).filter(block => block.cache_control !== undefined)).toEqual([{ type: "text", text: "second request", cache_control: { type: "ephemeral" } }]);
  expect(blocks(second).slice(0, 3).map(({ type, text }) => ({ type, text }))).toEqual(blocks(first).slice(0, 3).map(({ type, text }) => ({ type, text })));
  expect(first.cache_control).toBeUndefined();
  const stableBlocks = (body: Body) => blocks(body).filter(block => block.text?.startsWith("directory revision") !== true).map(block => {
    const stable = { ...block }; delete stable.cache_control; return stable;
  });
  const toolPrefix = stableBlocks(bodies[1]!);
  expect(stableBlocks(second).slice(0, toolPrefix.length)).toEqual(toolPrefix);
  expect(snapshot.role).toBe("user");
});

it("marks the outer final tool result rather than its text or the temporary image suffix", async () => {
  const { base, bodies, adapter } = fixture();
  const call = { ...message("assistant", ""), toolCalls: ["one", "two"].map(id => ({ id, name: "read_file", arguments: "{}" })) };
  const images: ModelMessage = { ...message("user", "current image"), attachments: [{ id: "image", contextTokens: 100, kind: "image", data: "eA==", mimeType: "image/png", name: "image.png", projectPath: null, source: "upload", readState: "full", truncated: false }] };
  await adapter.completeTurn({ ...base, messages: [message("system", "rules"), message("user", "request"), call,
    { ...message("tool", "first"), toolCallId: "one" }, { ...message("tool", "second"), toolCallId: "two" },
    { ...message("user", "skills"), runtimeContext: "skills" }, images] });
  const marked = blocks(bodies[0]!).filter(block => block.cache_control !== undefined);
  expect(marked).toEqual([{ type: "tool_result", tool_use_id: "two", content: "second", cache_control: { type: "ephemeral" } }]);
  expect(JSON.stringify(marked)).not.toContain("image");
});

it("does not add Anthropic cache writes to unrelated one-off background requests", async () => {
  const { base, bodies, adapter } = fixture();
  const uncached = { ...base };
  delete uncached.cacheKey;
  await adapter.completeTurn({ ...uncached, messages: [message("system", "rules"), message("user", "one-off")] });
  expect(JSON.stringify(bodies[0])).not.toContain("cache_control");
});
