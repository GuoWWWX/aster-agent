import { expect, it } from "vitest";
import { postTeamChatInputSchema, teamChatMessageSchema, teamChatPageSchema, teamChatCoordinationConversationInputSchema } from "./team-chat.js";

let nextId = 0;
const randomUUID = () => `10000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;

it("accepts owner/model selection and a linked edit, but rejects unknown config and duplicate recipients", () => {
  const base = { teamInstanceId: randomUUID(), content: "新的群消息", requestId: randomUUID() };
  const coordinator = { agentId: "default-agent", modelSelection: { providerId: randomUUID(), modelId: "gpt-6-luna", reasoning: null } };
  expect(postTeamChatInputSchema.parse({ ...base, coordinator, supersedesId: randomUUID() }).coordinator).toEqual(coordinator);
  expect(postTeamChatInputSchema.safeParse({ ...base, coordinator: { ...coordinator, instructions: "override" } }).success).toBe(false);
  const id = randomUUID(); expect(postTeamChatInputSchema.safeParse({ ...base, recipientConversationIds: [id, id] }).success).toBe(false);
});
it("reads old message/page shapes and validates bounded coordination memory without exposing it as owner config", () => {
  const id = randomUUID(); const room = randomUUID();
  const message = { id, teamInstanceId: room, sequence: 1, content: "旧群消息", senderConversationId: null, senderName: "你",
    intent: "request", recipientConversationIds: [], taskContextId: null, replyToId: null,
    createdAt: new Date().toISOString(), rootMessageId: id, depth: 0, sourceRunId: null, deliveries: [] };
  expect(teamChatMessageSchema.parse(message).id).toBe(id);
  const owner = { agentId: "default-agent", modelSelection: null };
  const coordinated = { ...message, coordinator: { ...owner, status: "completed", error: null, contextSummary: "仍待确认" } };
  expect(teamChatPageSchema.parse({ messages: [coordinated], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0, coordinator: owner }).messages).toHaveLength(1);
  expect(teamChatMessageSchema.safeParse({ ...coordinated, coordinator: { ...coordinated.coordinator, contextSummary: "a".repeat(2001) } }).success).toBe(false);
  const step = { type: "model_requested", at: new Date().toISOString(), attempt: 1, modelId: "fixture" };
  expect(teamChatMessageSchema.safeParse({ ...coordinated, coordinator: { ...coordinated.coordinator, steps: [step] } }).success).toBe(true);
  expect(teamChatMessageSchema.safeParse({ ...coordinated, coordinator: { ...coordinated.coordinator, steps: Array.from({ length: 65 }, () => step) } }).success).toBe(false);
});

it("accepts only a scoped owner-conversation request and validates actual Run references", () => {
  const teamInstanceId = "00000000-0000-4000-8000-000000000001";
  expect(teamChatCoordinationConversationInputSchema.parse({ teamInstanceId, agentId: "default-agent" })).toEqual({ teamInstanceId, agentId: "default-agent" });
  expect(teamChatCoordinationConversationInputSchema.safeParse({ teamInstanceId: "invalid" }).success).toBe(false);
  expect(teamChatCoordinationConversationInputSchema.safeParse({ teamInstanceId, conversationId: teamInstanceId }).success).toBe(false);
});
