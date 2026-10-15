import { describe, expect, it } from "vitest";
import type { ConversationToolItem } from "@agent/protocol";
import { htmlPresentationDeliveries } from "./html-presentations.js";

const tool: ConversationToolItem = { id: "delivery", kind: "tool", conversationId: "conversation", runId: "run",
  batchId: null, name: "present_html", status: "completed", arguments: '{"path":"demo.html"}', diff: null,
  result: '{"ok":true,"value":{"presentation":{"kind":"html","path":"demo.html"}}}', createdAt: "2026-10-15T00:00:00Z" };

describe("HTML delivery projection", () => {
  it("attaches a recorded tool reference after the last visible item of its own run", () => {
    const anchors = [{ id: "process", runId: "run" }, { id: "answer", runId: "run" }, { id: "next", runId: "other" }];
    expect([...htmlPresentationDeliveries([tool], anchors, null)]).toEqual([["answer", [{ id: "delivery", path: "demo.html" }]]]);
  });
  it("keeps deliveries when the final body is empty or adjacent answers are merged", () => {
    expect(htmlPresentationDeliveries([tool], [{ id: "process", runIds: ["run"] }], null).has("process")).toBe(true);
    expect(htmlPresentationDeliveries([tool], [{ id: "merged", runId: "other", continuationMessages: [{ runId: "run" }, { runId: "other" }] }], null).has("merged")).toBe(true);
  });
  it("keeps only the latest delivery for the same path across runs", () => {
    const next = { ...tool, id: "latest", runId: "next-run" };
    const anchors = [{ id: "answer", runId: "run" }, { id: "next-answer", runId: "next-run" }];
    expect([...htmlPresentationDeliveries([tool, next], anchors, null)])
      .toEqual([["next-answer", [{ id: "latest", path: "demo.html" }]]]);
    expect([...htmlPresentationDeliveries([tool, next], anchors, "next-run")])
      .toEqual([["answer", [{ id: "delivery", path: "demo.html" }]]]);
    expect([...htmlPresentationDeliveries([tool, { ...next, status: "failed" }], anchors, null)])
      .toEqual([["answer", [{ id: "delivery", path: "demo.html" }]]]);
  });
  it("keeps same-named files in separate directories as independent deliveries", () => {
    const other = { ...tool, id: "other", result: '{"ok":true,"value":{"presentation":{"kind":"html","path":"examples/demo.html"}}}' };
    expect(htmlPresentationDeliveries([tool, other], [{ id: "answer", runId: "run" }], null).get("answer"))
      .toEqual([{ id: "delivery", path: "demo.html" }, { id: "other", path: "examples/demo.html" }]);
  });
  it("keeps separate paths while replacing repeated deliveries within one run", () => {
    const other = { ...tool, id: "other", result: '{"ok":true,"value":{"presentation":{"kind":"html","path":"other.html"}}}' };
    expect([...htmlPresentationDeliveries([tool, other, { ...tool, id: "latest" }], [{ id: "answer", runId: "run" }], null)])
      .toEqual([["answer", [{ id: "latest", path: "demo.html" }, { id: "other", path: "other.html" }]]]);
  });
  it("ignores running, failed, cancelled, ordinary and malformed tool outputs", () => {
    const anchors = [{ id: "answer", runId: "run" }];
    expect(htmlPresentationDeliveries([tool], anchors, "run").size).toBe(0);
    for (const invalid of [
      { ...tool, status: "failed" as const }, { ...tool, status: "cancelled" as const },
      { ...tool, name: "write_file" }, { ...tool, result: "{" },
      { ...tool, result: '{"ok":false}' },
      { ...tool, result: '{"ok":true,"value":{"presentation":{"kind":"html","path":"../demo.html"}}}' },
    ]) expect(htmlPresentationDeliveries([invalid], anchors, null).size).toBe(0);
  });
});
