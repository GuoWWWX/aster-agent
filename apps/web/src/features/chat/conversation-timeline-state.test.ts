import { describe, expect, it } from "vitest";

import type { ConversationMessageItem } from "@agent/protocol";

import {
  appendAssistantDelta,
  completeStreamingAssistantMessages,
  shouldApplyTimelineLoad,
} from "./conversation-timeline-state.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";

function assistantMessage(
  id: string,
  content: string,
  status: ConversationMessageItem["status"] = "streaming",
): ConversationMessageItem {
  return {
    attachments: [],
    content,
    conversationId,
    createdAt: "2026-08-17T00:00:00.000Z",
    id,
    kind: "message",
    modelId: "test-model",
    role: "assistant",
    runId,
    status,
  };
}

describe("conversation timeline streaming state", () => {
  it("keeps only the assistant message receiving the current delta as streaming", () => {
    const first = assistantMessage("first", "第一段");

    const next = appendAssistantDelta([first], {
      conversationId,
      delta: "第二段",
      messageId: "second",
      modelId: "test-model",
      runId,
      type: "assistant.delta",
    });

    expect(next).toMatchObject([
      { content: "第一段", id: "first", status: "completed" },
      { content: "第二段", id: "second", status: "streaming" },
    ]);
  });

  it("completes the active text segment when output moves to a tool", () => {
    expect(completeStreamingAssistantMessages([
      assistantMessage("first", "第一段"),
      assistantMessage("second", "已完成", "completed"),
    ])).toMatchObject([
      { id: "first", status: "completed" },
      { id: "second", status: "completed" },
    ]);
  });

  it("does not replace newer streamed state with a stale timeline load", () => {
    expect(shouldApplyTimelineLoad(2, 2, 4, 4)).toBe(true);
    expect(shouldApplyTimelineLoad(1, 2, 4, 4)).toBe(false);
    expect(shouldApplyTimelineLoad(2, 2, 3, 4)).toBe(false);
  });
});
