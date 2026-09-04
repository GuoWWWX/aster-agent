import { z } from "zod";

import type { ConversationAgentMessageItem } from "@agent/protocol";

import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { buildConversationReferenceBundle } from "./conversation-reference.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

const LIST_AGENT_CONVERSATIONS_TOOL_NAME = "list_agent_conversations";
const READ_AGENT_CONVERSATION_TOOL_NAME = "read_agent_conversation";
const SEND_AGENT_MESSAGE_TOOL_NAME = "send_agent_message";
const SET_TEAM_COLLABORATION_PLAN_TOOL_NAME = "set_team_collaboration_plan";
const WAIT_FOR_AGENT_MESSAGE_TOOL_NAME = "wait_for_agent_message";
const toolNames = new Set([
  LIST_AGENT_CONVERSATIONS_TOOL_NAME,
  READ_AGENT_CONVERSATION_TOOL_NAME,
  SEND_AGENT_MESSAGE_TOOL_NAME,
  SET_TEAM_COLLABORATION_PLAN_TOOL_NAME,
  WAIT_FOR_AGENT_MESSAGE_TOOL_NAME,
]);
const conversationReadToolNames = new Set([
  LIST_AGENT_CONVERSATIONS_TOOL_NAME,
  READ_AGENT_CONVERSATION_TOOL_NAME,
]);

const emptyArgumentsSchema = z.object({}).strict();
const readConversationArgumentsSchema = z.object({
  beforeSequence: z.number().int().positive().optional()
    .describe("Optional cursor returned by a previous read. Only messages before this sequence are considered."),
  conversationId: z.string().uuid().optional()
    .describe("Target Agent conversation UUID. Omit it to query the current conversation."),
  historyScope: z.enum(["compressed", "all"]).default("compressed")
    .describe("History range to query. compressed reads messages covered by the latest compression checkpoint and falls back to all history when no checkpoint exists; all reads the entire persisted history."),
  maxTokens: z.number().int().min(256).max(12_288).default(4_096)
    .describe("Maximum estimated tokens allowed for this conversation snapshot."),
  query: z.string().trim().min(1).max(500).optional()
    .describe("Optional topic to retrieve from the target conversation. Relevant historical turns are prioritized while recent context remains bounded."),
}).strict();
const sendMessageArgumentsSchema = z.object({
  content: z.string().trim().min(1).max(20_000).describe("Message body to send to the target Agent."),
  conversationId: z.string().uuid().describe("Target Agent conversation UUID."),
  expectReply: z.boolean().default(true)
    .describe("Whether the target Agent should automatically return a bounded completion receipt to this conversation."),
  replyInstruction: z.string().trim().min(1).max(1_000).optional()
    .describe("Optional guidance for the concise completion receipt, such as required conclusions, evidence, or risks. Full details remain in the target conversation."),
}).strict();
const setTeamCollaborationPlanArgumentsSchema = z.object({
  reason: z.string().trim().min(1).max(2_000)
    .describe("Why this complete plan is appropriate, or what changed since the previous revision."),
  routes: z.array(z.object({
    fromConversationId: z.string().uuid()
      .describe("Sender participant conversation UUID from list_agent_conversations."),
    purpose: z.string().trim().min(1).max(500)
      .describe("Short responsibility or expected information carried on this route."),
    toConversationId: z.string().uuid()
      .describe("Recipient participant conversation UUID from list_agent_conversations."),
  }).strict()).min(1).max(80)
    .describe("Complete directed route set for this revision, including Team Lead return paths."),
}).strict();
const waitForMessageArgumentsSchema = z.object({
  conversationId: z.string().uuid().optional()
    .describe("Optional sender Agent conversation UUID. Omit it to accept a message from any Agent."),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000)
    .describe("Maximum wait in milliseconds. A timeout does not cancel the sender's work."),
}).strict();

type CommunicationToolExecution = {
  content: string;
  isError: boolean;
  kind: "completed";
};

type MessageWaiter = {
  fromConversationId: string | undefined;
  recipientConversationId: string;
  resolve: (message: ConversationAgentMessageItem) => void;
};

export function isAgentCommunicationToolName(name: string): boolean {
  return toolNames.has(name);
}

export class AgentCommunicationTool {
  private readonly messageWaiters = new Set<MessageWaiter>();

  public constructor(private readonly database: AgentDatabase) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [
      {
        description: "List other Agent conversations and their explicit status, identifiers, roles, projects, active Run, and active Subagent count. Use it at any time to check whether an Agent is idle, running, completed, failed, or cancelled.",
        name: LIST_AGENT_CONVERSATIONS_TOOL_NAME,
        parameters: modelToolParameters(emptyArgumentsSchema),
      },
      {
        description: "Read a bounded snapshot of the current or another Agent conversation at any time, including while it is running. Pass query to retrieve matching complete turns, including the user question, Agent answer, tool calls, and tool results. historyScope defaults to compressed history covered by the latest checkpoint, or all history when no checkpoint exists; pass all to search the entire persisted history. Continue older results with pagination.nextBeforeSequence as beforeSequence. It never exceeds maxTokens.",
        name: READ_AGENT_CONVERSATION_TOOL_NAME,
        parameters: modelToolParameters(readConversationArgumentsSchema),
      },
      {
        description: "Send a persistent message to another Agent conversation. A running recipient receives it before the next model turn; an idle recipient starts automatically. With expectReply=true, the recipient returns only a bounded completion receipt and keeps its full answer in its own conversation; use replyInstruction to request receipt focus. Use expectReply=false for progress updates or notifications.",
        name: SEND_AGENT_MESSAGE_TOOL_NAME,
        parameters: modelToolParameters(sendMessageArgumentsSchema),
      },
      {
        description: "Publish the current Team WorkItem's complete advisory communication plan before delegating work. Only the WorkItem Team Lead can use this tool. List participant conversations first, then define directed routes and their purposes, including expected result paths back to the Team Lead. Publish a new complete revision when the route changes. The plan never blocks legitimate send_agent_message calls.",
        name: SET_TEAM_COLLABORATION_PLAN_TOOL_NAME,
        parameters: modelToolParameters(setTeamCollaborationPlanArgumentsSchema),
      },
      {
        description: "Wait for the next Agent message, optionally from one conversation. The returned message includes senderConversationId and senderTitle; reply by passing senderConversationId as send_agent_message.conversationId. Use this after asking a conflicting Agent to notify you. The wait is cancellable and bounded by timeoutMs.",
        name: WAIT_FOR_AGENT_MESSAGE_TOOL_NAME,
        parameters: modelToolParameters(waitForMessageArgumentsSchema),
      },
    ];
  }

  public getConversationReadDefinitions(): ModelToolDefinition[] {
    return this.getDefinitions().filter((definition) =>
      conversationReadToolNames.has(definition.name),
    );
  }

  public getCoordinationDefinitions(): ModelToolDefinition[] {
    return this.getDefinitions().filter((definition) =>
      !conversationReadToolNames.has(definition.name),
    );
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    switch (toolName) {
      case LIST_AGENT_CONVERSATIONS_TOOL_NAME:
      case READ_AGENT_CONVERSATION_TOOL_NAME:
        return { group: "read", kind: "parallel" };
      case SEND_AGENT_MESSAGE_TOOL_NAME:
      case SET_TEAM_COLLABORATION_PLAN_TOOL_NAME:
      case WAIT_FOR_AGENT_MESSAGE_TOOL_NAME:
        return { kind: "serial" };
      default:
        throw new Error(`Unknown Agent communication tool: ${toolName}`);
    }
  }

  public async execute(input: {
    arguments: string;
    conversationId: string;
    onMessagesRead?: (messageIds: readonly string[]) => void;
    onMessageSent?: (message: ConversationAgentMessageItem) => void;
    runId: string;
    signal: AbortSignal;
    toolName: string;
  }): Promise<CommunicationToolExecution> {
    try {
      const argumentsValue = parseToolArguments(input.arguments);
      switch (input.toolName) {
        case LIST_AGENT_CONVERSATIONS_TOOL_NAME: {
          emptyArgumentsSchema.parse(argumentsValue);
          const conversations = this.database.listAgentConversations()
            .filter((conversation) => conversation.id !== input.conversationId)
            .map((conversation) => ({
              activeSubagentCount: conversation.activeSubagentCount,
              activeRunId: conversation.activeRunId,
              agentId: conversation.agentId,
              conversationId: conversation.id,
              lastRunStatus: conversation.lastRunStatus,
              projectId: conversation.projectId,
              status: agentConversationStatus(conversation),
              teamId: conversation.teamId,
              threadKind: conversation.threadKind,
              title: conversation.title,
            }));
          return success({ conversations });
        }
        case READ_AGENT_CONVERSATION_TOOL_NAME: {
          const parsed = readConversationArgumentsSchema.parse(argumentsValue);
          const targetConversationId = parsed.conversationId ?? input.conversationId;
          const checkpoint = this.database.getContextCheckpoint(targetConversationId);
          const historyScope = parsed.historyScope === "compressed" && checkpoint === null
            ? "all"
            : parsed.historyScope;
          const reference = buildConversationReferenceBundle({
            allowCurrentConversation: true,
            ...(parsed.beforeSequence === undefined
              ? {}
              : { beforeSequence: parsed.beforeSequence }),
            budgetTokens: parsed.maxTokens,
            currentConversationId: input.conversationId,
            database: this.database,
            historyScope,
            ...(parsed.query === undefined ? {} : { query: parsed.query }),
            referencedConversationIds: [targetConversationId],
          });
          const conversation = this.database.getConversation(targetConversationId);
          return success({
            ...reference,
            checkpointCoveredThroughSequence: checkpoint?.coveredThroughSequence ?? null,
            historyScope,
            pagination: reference.pagination[0] ?? null,
            ...(parsed.query === undefined ? {} : { query: parsed.query }),
            requestedHistoryScope: parsed.historyScope,
            conversation: {
              activeSubagentCount: conversation.activeSubagentCount,
              activeRunId: conversation.activeRunId,
              conversationId: conversation.id,
              lastRunStatus: conversation.lastRunStatus,
              status: agentConversationStatus(conversation),
              title: conversation.title,
            },
          });
        }
        case SEND_AGENT_MESSAGE_TOOL_NAME: {
          const parsed = sendMessageArgumentsSchema.parse(argumentsValue);
          const teamExecutionConversationId = this.database
            .getTeamExecutionConversationIdForParticipant(input.conversationId);
          if (
            teamExecutionConversationId !== null
            && !this.database.areTeamExecutionParticipants(input.conversationId, parsed.conversationId)
          ) {
            throw new Error("A Team participant may send messages only to members of the same persistent Team.");
          }
          const message = this.database.sendAgentMessage({
            content: parsed.content,
            messageType: parsed.expectReply ? "message" : "notification",
            replyInstruction: parsed.expectReply ? parsed.replyInstruction ?? null : null,
            runId: input.runId,
            senderConversationId: input.conversationId,
            targetConversationId: parsed.conversationId,
          });
          this.notifyMessage(message);
          input.onMessageSent?.(message);
          return success({ message });
        }
        case SET_TEAM_COLLABORATION_PLAN_TOOL_NAME: {
          const parsed = setTeamCollaborationPlanArgumentsSchema.parse(argumentsValue);
          const projection = this.database.setTeamCollaborationPlan({
            createdByConversationId: input.conversationId,
            reason: parsed.reason,
            routes: parsed.routes,
          });
          return success({
            plan: projection.plan,
            summary: projection.summary,
            workItemId: projection.workItemId,
          });
        }
        case WAIT_FOR_AGENT_MESSAGE_TOOL_NAME: {
          const parsed = waitForMessageArgumentsSchema.parse(argumentsValue);
          const existing = this.database.listUnreadAgentMessages(
            input.conversationId,
            parsed.conversationId,
          )[0];
          if (existing !== undefined) {
            this.database.markAgentMessagesRead([existing.id]);
            input.onMessagesRead?.([existing.id]);
            return success({ message: existing, status: "received" });
          }
          const message = await this.waitForMessage({
            fromConversationId: parsed.conversationId,
            recipientConversationId: input.conversationId,
            signal: input.signal,
            timeoutMs: parsed.timeoutMs,
          });
          if (message === null) return success({ message: null, status: "timeout" });
          this.database.markAgentMessagesRead([message.id]);
          input.onMessagesRead?.([message.id]);
          return success({ message, status: "received" });
        }
        default:
          throw new Error(`Unknown Agent communication tool: ${input.toolName}`);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
      return {
        content: toolErrorContent(error, `tool:${input.toolName}`),
        isError: true,
        kind: "completed",
      };
    }
  }

  public notifyMessage(message: ConversationAgentMessageItem): void {
    const waiter = [...this.messageWaiters].find((candidate) =>
      candidate.recipientConversationId === message.conversationId
      && (
        candidate.fromConversationId === undefined
        || candidate.fromConversationId === message.senderConversationId
      )
    );
    if (waiter === undefined) return;
    this.messageWaiters.delete(waiter);
    waiter.resolve(message);
  }

  private waitForMessage(input: {
    fromConversationId: string | undefined;
    recipientConversationId: string;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<ConversationAgentMessageItem | null> {
    if (input.signal.aborted) {
      return Promise.reject(toAbortError(input.signal.reason));
    }
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        input.signal.removeEventListener("abort", onAbort);
        this.messageWaiters.delete(waiter);
      };
      const onAbort = (): void => {
        cleanup();
        reject(toAbortError(input.signal.reason));
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, input.timeoutMs);
      const waiter: MessageWaiter = {
        fromConversationId: input.fromConversationId,
        recipientConversationId: input.recipientConversationId,
        resolve: (message) => {
          cleanup();
          resolve(message);
        },
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      this.messageWaiters.add(waiter);
    });
  }
}

function agentConversationStatus(conversation: {
  activeRunId: string | null;
  lastRunStatus: "queued" | "running" | "completed" | "failed" | "cancelled" | null;
}): "idle" | "queued" | "running" | "completed" | "failed" | "cancelled" {
  if (conversation.activeRunId !== null) return "running";
  return conversation.lastRunStatus ?? "idle";
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function success(value: unknown): CommunicationToolExecution {
  return {
    content: JSON.stringify({ ok: true, value }),
    isError: false,
    kind: "completed",
  };
}
