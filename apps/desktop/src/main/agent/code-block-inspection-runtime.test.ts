import { expect, it, vi } from "vitest";
import { codeBlockPreviewReferenceSchema, conversationTimelineItemSchema } from "@agent/protocol";
import { AgentRuntime } from "./agent-runtime.js";
import { HtmlPresentationTool, resolveHtmlPresentationSource } from "../tools/html-presentation-tool.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import type { CompleteTurnInput, ModelTurnResult } from "../model/model-contracts.js";

it("persists assistant source before inspection and sends it only once in subsequent model context", async () => {
  const db = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(db);
  const tools = new ProjectToolRegistry(projects);
  const conversation = db.createConversation(null);
  const code = "export default () => <button>Original source</button>";
  const content = `\`\`\`react\n${code}\n\`\`\``;
  const inspect = vi.fn().mockResolvedValue({ kind: "completed", isError: false, content: '{"ok":true,"value":{"inspected":true,"frames":3}}' });
  const presentation = new HtmlPresentationTool(() => Promise.reject(new Error("No workspace needed")), { inspect }, (owner, reference) =>
    resolveHtmlPresentationSource(db.listTimeline(owner).filter(item => item.kind === "message" || item.kind === "tool"), reference), () => ({ width: 1024, height: 768 }));
  const requests: CompleteTurnInput[] = [];
  const model = { completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    requests.push(input);
    if (requests.length === 1) return Promise.resolve({ content, finishReason: "tool_calls",
      toolCalls: [{ id: "inspect", name: "present_html", arguments: JSON.stringify({ action: "inspect", sourceRef: "latest", frames: 3, intervalMs: 600 }) }] });
    const result = input.messages.find(message => message.role === "tool" && message.toolCallId === "inspect")!;
    const value = codeBlockPreviewReferenceSchema.parse(JSON.parse(result.content));
    expect(value.value.displayRef).toMatch(/^codeblock:/u);
    expect(result.content).not.toContain(code);
    expect(input.messages.filter(message => message.content.includes(code))).toHaveLength(1);
    return Promise.resolve({ content: `已检查。\n\n[React 作品](${value.value.displayRef})`, finishReason: "stop", toolCalls: [] });
  } };
  const runtime = new AgentRuntime(db, { getConfiguration: () => ({ apiFormat: "openai-responses", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] }) },
    projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null, null, null, null, null, null, null, null, {}, null, null, null, presentation);
  try {
    await new Promise<void>(resolve => runtime.sendMessage({ conversationId: conversation.id, content: "制作 React 页面" }, event => {
      if (event.type === "run.finished") { expect(event.status).toBe("completed"); resolve(); }
    }));
    expect(requests).toHaveLength(2);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ width: 1024, height: 768, frames: 3, intervalMs: 600,
      source: { kind: "code", html: `${code}\n`, language: "react", conversationId: conversation.id } }));
    const source = db.listTimeline(conversation.id).find(item => item.kind === "message" && item.content === content)!;
    const ref = `codeblock:${source.id}:1`;
    const reloaded = conversationTimelineItemSchema.array().parse(JSON.parse(JSON.stringify(db.listTimeline(conversation.id))));
    expect(resolveHtmlPresentationSource(reloaded.filter(item => item.kind === "message" || item.kind === "tool"), ref)).toMatchObject({ code: `${code}\n`, sourceRef: ref });
  } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
});
