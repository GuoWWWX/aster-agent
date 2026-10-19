import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { teamChatMessageSchema } from "@agent/protocol";
import { teamChatContext, teamChatReadThrough } from "./team-chat-context.js";

it("distinguishes the user, the receiver's own statements and named peers within a fixed budget", () => {
  const receiver = randomUUID(); const room = randomUUID(); const thread = randomUUID();
  const messages = Array.from({ length: 24 }, (_, index) => teamChatMessageSchema.parse({
    id: randomUUID(), teamInstanceId: room, sequence: index + 1, content: "相关讨论🙂".repeat(600),
    senderConversationId: index % 3 === 0 ? null : index % 3 === 1 ? receiver : randomUUID(), senderName: "需求分析师",
    intent: "notify", recipientConversationIds: [], taskContextId: null, replyToId: null, createdAt: new Date().toISOString(),
    rootMessageId: thread, depth: 0, sourceRunId: null, deliveries: [],
  }));
  const source = { ...messages[23]!, sequence: 25, replyToId: messages[0]!.id };
  messages[0]!.fileReferences = [{ path: "out/card.html", sourceMessageId: messages[0]!.id, conversationId: receiver }];
  const context = teamChatContext(messages, receiver, source, 6000);
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(6000);
  expect(context[0]?.messageId).toBe(messages[0]!.id);
  expect(context[0]?.fileReferences).toEqual(messages[0]!.fileReferences);
  expect(new Set(context.map(item => item.perspective))).toEqual(new Set(["user", "self", "member"]));
  expect(context.some(item => item.excerpted)).toBe(true);
  expect(context.map(item => item.sequence)).toEqual(context.map(item => item.sequence).sort((a, b) => a - b));
  expect(teamChatReadThrough(context, source, 0)).toBe(0);
  const complete = context.map((message, index) => ({ ...message, sequence: index + 1, excerpted: false }));
  expect(teamChatReadThrough(complete, { ...source, sequence: complete.length + 1 }, 0)).toBe(complete.length + 1);
  expect(teamChatReadThrough([{ ...complete[0]!, sequence: 2 }], { ...source, sequence: 3 }, 0)).toBe(0);
});
