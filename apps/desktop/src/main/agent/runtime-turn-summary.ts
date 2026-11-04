import { estimateContextTokens, type ConversationAgentMessageItem } from "@agent/protocol";
import { type ManagedContextSourceMessage } from "./context-manager.js";

const TURN_SUMMARY_COMPONENT_BASE_TOKENS = 448;

const TURN_SUMMARY_COMPONENT_MIN_TOKENS = 320;

const TURN_SUMMARY_COMPONENT_STEP_TOKENS = 48;

const LOCAL_TURN_SUMMARY_FIELD_CHARACTERS = 720;

export function isManualContextCompactionCommand(content: string): boolean {
  return content.trim().toLowerCase() === "/compact";
}

function boundedTurnSummaryText(content: string): string {
  const normalized = content.trim().replace(/\s+/gu, " ");
  if (normalized.length <= LOCAL_TURN_SUMMARY_FIELD_CHARACTERS) return normalized;
  return `${normalized.slice(0, LOCAL_TURN_SUMMARY_FIELD_CHARACTERS - 1).trimEnd()}…`;
}

function stripSteerEnvelope(content: string): string {
  const marker = "[End runtime steer note]";
  const markerIndex = content.indexOf(marker);
  return markerIndex < 0 ? content : content.slice(markerIndex + marker.length).trimStart();
}

function labelTurnSummaryMessage(
  message: ManagedContextSourceMessage,
): ManagedContextSourceMessage {
  const prefix = message.role === "user"
    ? message.content.startsWith("[Runtime steer note]")
      ? "[Steer input]"
      : "[User input]"
    : message.role === "assistant"
      ? "[Assistant result]"
      : "[Tool evidence]";
  const content = message.role === "user"
    ? stripSteerEnvelope(message.content)
    : message.content;
  return { ...message, content: `${prefix}\n${content}` };
}

export function createTurnSummarySourceMessages(
  messages: readonly ManagedContextSourceMessage[],
  agentInputs: readonly (
    Pick<
      ConversationAgentMessageItem,
      "content" | "senderConversationId" | "senderTitle"
    > & Partial<Pick<ConversationAgentMessageItem, "messageType">>
  )[],
): ManagedContextSourceMessage[] {
  const userInputs = messages
    .filter((message) => message.role === "user")
    .map(labelTurnSummaryMessage);
  const boundary = messages.at(-1);
  const agentMessages = agentInputs.map((message, index): ManagedContextSourceMessage => ({
    attachmentIds: [],
    attachments: [],
    content: [
      `[Agent input: ${message.senderTitle} · ${message.senderConversationId}${
        message.messageType === undefined ? "" : ` · ${message.messageType}`
      }]`,
      message.content,
    ].join("\n"),
    role: "user",
    runId: boundary?.runId ?? null,
    sequence: (boundary?.sequence ?? 0) + index + 1,
    toolCallId: null,
    toolCalls: [],
  }));
  const resultsAndEvidence = messages
    .filter((message) => message.role !== "user")
    .map(labelTurnSummaryMessage);
  return [...userInputs, ...agentMessages, ...resultsAndEvidence];
}

export function createLocalTurnSummary(messages: readonly ManagedContextSourceMessage[]): string {
  const requirements = messages
    .filter((message) => message.role === "user")
    .map((message) => boundedTurnSummaryText(message.content))
    .filter((content) => content.length > 0)
    .slice(-4);
  const taskStatus = messages
    .filter((message) => message.role === "assistant")
    .map((message) => boundedTurnSummaryText(message.content))
    .filter((content) => content.length > 0)
    .slice(-2);
  const toolEvidence = messages
    .filter((message) => message.role === "tool")
    .map((message) => boundedTurnSummaryText(message.content))
    .filter((content) => content.length > 0)
    .slice(-2);
  return JSON.stringify({
    artifactRefs: [],
    commands: [],
    constraints: [],
    decisions: [],
    errors: [],
    filesChanged: [],
    filesRead: [],
    goals: requirements,
    pendingWork: [],
    rejectedApproaches: [],
    requirements,
    taskStatus: [...taskStatus, ...toolEvidence],
    testResults: [],
  });
}

export function shouldGenerateModelTurnSummary(
  messages: readonly ManagedContextSourceMessage[],
): boolean {
  const roleTokens = (["user", "assistant", "tool"] as const).map((role) => messages
    .filter((message) => message.role === role)
    .reduce((total, message) => total + estimateContextTokens(message.content), 0));
  const populatedComponentCount = roleTokens.filter((tokens) => tokens > 0).length;
  if (populatedComponentCount === 0) return false;
  const componentThreshold = Math.max(
    TURN_SUMMARY_COMPONENT_MIN_TOKENS,
    TURN_SUMMARY_COMPONENT_BASE_TOKENS
      - (populatedComponentCount - 1) * TURN_SUMMARY_COMPONENT_STEP_TOKENS,
  );
  const totalTokens = roleTokens.reduce((total, tokens) => total + tokens, 0);
  return roleTokens.some((tokens) => tokens > componentThreshold)
    || totalTokens > componentThreshold * 2;
}
