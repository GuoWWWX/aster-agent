import { describe, expect, it } from "vitest";
import { conversationToolItemSchema, imageGenerationResultSchema } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { conversationArtifacts } from "./conversation-artifacts.js";

const id = "00000000-0000-4000-8000-000000000001", ref = `artifact:${id}`;
const tool = conversationToolItemSchema.parse({ id, conversationId: id, runId: id, kind: "tool", name: "present_html",
  status: "completed", arguments: "{}", result: null, diff: null, createdAt: "2026-10-19T00:00:00Z" });
const client = new MockAgentClient(), options = { cacheTtlMs: 1000, onResize: () => undefined };
const image = { id, conversationId: id, messageId: id, source: "generated", name: "output.png", kind: "image", mimeType: "image/png", sizeBytes: 1,
  contextTokens: 1024, projectPath: null, truncated: false, createdAt: tool.createdAt };

describe("conversation-owned artifact lookup", () => {
  it("displays an inspected code fence by reference after reload without requiring source in the tool result", () => {
    const reference = `codeblock:${id}:1`;
    const entry = { ...tool, result: JSON.stringify({ ok: true, value: { inspected: true, displayRef: reference, sourceRef: reference, language: "react", frames: 3 } }) };
    const found = conversationArtifacts([JSON.parse(JSON.stringify(entry))], client, options);
    expect(found.get(reference)).toMatchObject({ toolId: id });
    expect(entry.result).not.toContain("export default");
    expect(conversationArtifacts([{ ...entry, status: "failed" }], client, options).size).toBe(0);
  });
  it("reuses HTML, React, Vue, file and gallery outputs, preserving the reference across reloads", () => {
    for (const presentation of [
      ...["html", "react", "vue"].map(language => ({ kind: "code", html: "source", language })),
      { kind: "html", path: "demo.html" },
      { kind: "html_gallery", pages: [{ kind: "code", title: "A", html: "A" }, { kind: "code", title: "B", html: "B" }] },
    ]) {
      const entry = { ...tool, result: JSON.stringify({ ok: true, value: { displayRef: ref, presentation } }) };
      expect(conversationArtifacts([JSON.parse(JSON.stringify(entry))], client, options).get(ref)).toMatchObject({ toolId: id });
      expect(conversationArtifacts([{ ...entry, status: "failed" }], client, options).size).toBe(0);
    }
  });

  it("registers saved image batches including partial results, excluding foreign attachments", () => {
    const entry = { ...tool, name: "generate_images", status: "failed" as const, result: JSON.stringify({ ok: true, value: {
      displayRef: ref, images: [image], count: 1, requestedCount: 2, modelId: "image", providerId: id, notice: "Partial result",
    } }) };
    expect(conversationArtifacts([entry], client, options).get(ref)).toMatchObject({ toolId: id });
    const value = imageGenerationResultSchema.parse(JSON.parse(entry.result)).value;
    for (const foreign of [{ ...image, conversationId: "00000000-0000-4000-8000-000000000002" }, { ...image, messageId: "00000000-0000-4000-8000-000000000002" }]) {
      expect(conversationArtifacts([{ ...entry, result: JSON.stringify({ ok: true, value: { ...value, images: [foreign] } }) }], client, options).size).toBe(0);
    }
  });

  it("does not turn inspection, failed, malformed or legacy results into fabricated references", () => {
    for (const result of ["{", '{"ok":false}', '{"ok":true,"value":{"inspected":true}}',
      JSON.stringify({ ok: true, value: { presentation: { kind: "html", path: "demo.html" } } }),
      JSON.stringify({ ok: true, value: { displayRef: "artifact:../private.html", presentation: { kind: "html", path: "demo.html" } } }),
    ]) expect(conversationArtifacts([{ ...tool, result }], client, options).size).toBe(0);
  });
});
