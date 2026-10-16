import { expect, it } from "vitest";
import { userQuestionSchema, type ConversationMessageItem, type ConversationToolItem } from "@agent/protocol";
import { questionForAnswer, questionToolForAnswer } from "./question-answer-reference.js";

const root = "00000000-0000-4000-8000-000000000001";
const child = "00000000-0000-4000-8000-000000000002";
const question = userQuestionSchema.parse({
  id: "00000000-0000-4000-8000-000000000003", conversationId: child,
  displayConversationId: root, runId: "00000000-0000-4000-8000-000000000004",
  toolCallId: "ask-1", sourceTitle: "前端代理",
  questions: [{ id: "scope", title: "范围", question: "检查哪些页面？", options: [] }],
  status: "answered", answers: { scope: "设置页面" },
  createdAt: "2026-10-14T01:00:00Z", answeredAt: "2026-10-14T01:01:00Z",
  viewed: true, deliveryComplete: true,
});

it("links an answered message to its exact question and originating tool", () => {
  const message = {
    role: "user", conversationId: root, createdAt: "2026-10-14T01:01:01Z",
    content: "用户回答了子代理「前端代理」的提问，回答也已送回该代理。\n\n范围\n检查哪些页面？\n用户回答：设置页面",
  } as ConversationMessageItem;
  const tool = { kind: "tool", name: "request_user_input", runId: question.runId,
    result: JSON.stringify({ questionId: question.id }), id: "tool-1" } as ConversationToolItem;
  expect(questionForAnswer(message, [question])).toEqual(question);
  expect(questionForAnswer({ ...message, content: `${message.content}补充` }, [question])).toBeNull();
  expect(questionToolForAnswer([tool], question)).toEqual(tool);
  expect(questionToolForAnswer([{ ...tool, result: JSON.stringify({ questionId: "another" }) }], question)).toBeNull();
});
