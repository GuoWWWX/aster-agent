import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  conversationMessageItemSchema,
  conversationRunStatusSchema,
  conversationTimelineItemSchema,
  conversationToolItemSchema,
  type ConversationMessageItem,
  type ConversationModelRetryItem,
  type ConversationRunStatus,
  type ConversationTimelineItem,
  type ConversationToolItem,
} from "@agent/protocol";

import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";
import type { CompleteRunInput, StoredModelMessage } from "./conversation-storage-contracts.js";
import { asString, parseJson, type DatabaseRow } from "./database-row.js";

export const RUN_STATUS_TRANSITIONS: Readonly<Record<
  ConversationRunStatus,
  readonly ConversationRunStatus[]
>> = {
  cancelled: [],
  completed: [],
  failed: [],
  queued: ["running", "completed", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
};

type AssistantTurnInput = {
  content: string;
  conversationId: string;
  messageId: string;
  modelId: string;
  providerState?: ModelProviderState;
  reasoningContent?: string;
  runId: string;
  toolCalls: ModelToolCall[];
};

type AssistantFailureInput = {
  content: string;
  conversationId: string;
  messageId: string;
  modelId: string;
  runId: string;
};

type PreparedAssistantTurn = {
  input: AssistantTurnInput;
  message: ConversationMessageItem | null;
  now: string;
};
type PreparedAssistantFailure = {
  input: AssistantFailureInput;
  message: ConversationMessageItem;
  now: string;
};

/** Keep message validation and its timestamp before the caller opens its transaction. */
export function prepareAssistantTurn(input: AssistantTurnInput): PreparedAssistantTurn {
  const now = new Date().toISOString();
  const message =
    input.content.length === 0 && (input.reasoningContent?.length ?? 0) === 0
      ? null
      : conversationMessageItemSchema.parse({
          content: input.content,
          conversationId: input.conversationId,
          createdAt: now,
          id: input.messageId,
          kind: "message",
          modelId: input.modelId,
          ...(input.reasoningContent === undefined
            ? {}
            : { reasoningContent: input.reasoningContent }),
          role: "assistant",
          runId: input.runId,
          status: "completed"
        });

  return { input, message, now };
}

export function prepareAssistantFailure(input: AssistantFailureInput): PreparedAssistantFailure {
  const now = new Date().toISOString();
  const message = conversationMessageItemSchema.parse({
    content: input.content,
    conversationId: input.conversationId,
    createdAt: now,
    id: input.messageId,
    kind: "message",
    modelId: input.modelId,
    role: "assistant",
    runId: input.runId,
    status: "failed"
  });

  return { input, message, now };
}

/**
 * Persists Run events on the caller's connection and transaction. The facade
 * owns cross-Conversation completion, Subagent receipts and recovery ordering.
 */
export class ConversationRunEventRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public appendTerminalAssistant(input: Pick<CompleteRunInput, "assistant" | "conversationId" | "runId">): ConversationMessageItem | null {
    let assistantMessage: ConversationMessageItem | null = null;
    if (input.assistant?.kind === "turn") {
      const now = new Date().toISOString();
      assistantMessage = input.assistant.content.length === 0
        && (input.assistant.reasoningContent?.length ?? 0) === 0
        ? null
        : conversationMessageItemSchema.parse({
            content: input.assistant.content,
            conversationId: input.conversationId,
            createdAt: now,
            id: input.assistant.messageId,
            kind: "message",
            modelId: input.assistant.modelId,
            ...(input.assistant.reasoningContent === undefined
              ? {}
              : { reasoningContent: input.assistant.reasoningContent }),
            role: "assistant",
            runId: input.runId,
            status: "completed"
          });
      this.insertModelMessage({
        attachmentIds: [],
        content: input.assistant.content,
        conversationId: input.conversationId,
        ...(input.assistant.providerState === undefined
          ? {}
          : { providerState: input.assistant.providerState }),
        role: "assistant",
        runId: input.runId,
        toolCallId: null,
        toolCalls: []
      });
      if (assistantMessage !== null) this.insertTimelineItem(assistantMessage);
      this.touchConversation(input.conversationId, now);
    } else if (input.assistant?.kind === "failure") {
      const now = new Date().toISOString();
      assistantMessage = conversationMessageItemSchema.parse({
        content: input.assistant.content,
        conversationId: input.conversationId,
        createdAt: now,
        id: input.assistant.messageId,
        kind: "message",
        modelId: input.assistant.modelId,
        role: "assistant",
        runId: input.runId,
        status: "failed"
      });
      this.insertTimelineItem(assistantMessage);
      this.touchConversation(input.conversationId, now);
    } else if (input.assistant?.kind === "cancelled") {
      const now = new Date().toISOString();
      assistantMessage = input.assistant.content.length === 0
        && (input.assistant.reasoningContent?.length ?? 0) === 0
        ? null
        : conversationMessageItemSchema.parse({
            content: input.assistant.content,
            conversationId: input.conversationId,
            createdAt: now,
            id: input.assistant.messageId,
            kind: "message",
            modelId: input.assistant.modelId,
            ...(input.assistant.reasoningContent === undefined
              ? {}
              : { reasoningContent: input.assistant.reasoningContent }),
            role: "assistant",
            runId: input.runId,
            status: "cancelled"
          });
      this.insertModelMessage({
        attachmentIds: [],
        content: input.assistant.content,
        conversationId: input.conversationId,
        ...(input.assistant.providerState === undefined
          ? {}
          : { providerState: input.assistant.providerState }),
        role: "assistant",
        runId: input.runId,
        toolCallId: null,
        toolCalls: []
      });
      if (assistantMessage !== null) this.insertTimelineItem(assistantMessage);
      this.touchConversation(input.conversationId, now);
    }

    return assistantMessage;
  }

  public appendAssistantTurn(prepared: PreparedAssistantTurn): void {
    const { input, message, now } = prepared;
    this.insertModelMessage({
      attachmentIds: [],
      content: input.content,
      conversationId: input.conversationId,
      ...(input.providerState === undefined ? {} : { providerState: input.providerState }),
      role: "assistant",
      runId: input.runId,
      toolCallId: null,
      toolCalls: input.toolCalls
    });
    if (message !== null) {
      this.insertTimelineItem(message);
    }
    this.touchConversation(input.conversationId, now);
  }

  public appendAssistantFailure(prepared: PreparedAssistantFailure): void {
    const { message, now, input } = prepared;
    this.insertTimelineItem(message);
    this.touchConversation(input.conversationId, now);
  }

  public appendToolStarted(tool: ConversationToolItem): void {
    const validated = conversationToolItemSchema.parse(tool);
    this.insertTimelineItem(validated);
  }

  public updateTool(tool: ConversationToolItem): void {
    const validated = conversationToolItemSchema.parse(tool);
    const update = this.database
      .prepare(
        `UPDATE conversation_timeline SET payload_json = ?
         WHERE id = ? AND kind = 'tool'`
      )
      .run(JSON.stringify(validated), validated.id);
    if (update.changes !== 1) {
      throw new Error("Tool timeline item was not found.");
    }
    this.touchConversation(validated.conversationId, new Date().toISOString());
  }

  public upsertRuntimeActivity(validated: ConversationToolItem): void {
    this.insertThreadLogTimeline(validated);
    this.database
      .prepare(
        `UPDATE conversation_timeline SET payload_json = ?, created_at = ?
           WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .run(
        JSON.stringify(validated),
        validated.createdAt,
        validated.id,
        validated.conversationId,
      );
    this.touchConversation(validated.conversationId, new Date().toISOString());
  }

  public completeTool(input: {
    providerCallId: string;
    result: string;
    tool: ConversationToolItem;
  }, tool: ConversationToolItem): void {
    this.updateTool(tool);
    this.insertModelMessage({
      attachmentIds: [],
      content: input.result,
      conversationId: tool.conversationId,
      role: "tool",
      runId: tool.runId,
      toolCallId: input.providerCallId,
      toolCalls: []
    });
    this.touchConversation(tool.conversationId, new Date().toISOString());
  }

  public insertTimelineItem(item: ConversationTimelineItem): void {
    const validated = conversationTimelineItemSchema.parse(item);
    this.database
      .prepare(
        `INSERT INTO conversation_timeline
           (id, conversation_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.runId,
        validated.kind,
        JSON.stringify(validated),
        validated.createdAt
      );
  }

  public insertModelMessage(input: {
    attachmentIds: readonly string[];
    content: string;
    conversationId: string;
    providerState?: ModelProviderState;
    role: StoredModelMessage["role"];
    runId: string | null;
    toolCallId: string | null;
    toolCalls: ModelToolCall[];
  }): void {
    this.database
      .prepare(
        `INSERT INTO model_messages
           (id, conversation_id, run_id, role, content, tool_calls_json,
            tool_call_id, attachment_ids_json, provider_state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.conversationId,
        input.runId,
        input.role,
        input.content,
        JSON.stringify(input.toolCalls),
        input.toolCallId,
        JSON.stringify(input.attachmentIds),
        input.providerState === undefined ? null : JSON.stringify(input.providerState),
        new Date().toISOString()
      );
  }

  public insertThreadLogTimeline(item: ConversationTimelineItem): void {
    const validated = conversationTimelineItemSchema.parse(item);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO conversation_timeline
           (id, conversation_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.runId,
        validated.kind,
        JSON.stringify(validated),
        validated.createdAt,
      );
  }

  public insertThreadLogModelMessage(input: {
    attachmentIds: readonly string[];
    content: string;
    conversationId: string;
    createdAt: string;
    eventId: string;
    providerState?: ModelProviderState;
    role: StoredModelMessage["role"];
    runId: string | null;
    toolCallId: string | null;
    toolCalls: ModelToolCall[];
  }): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO model_messages
           (id, conversation_id, run_id, role, content, tool_calls_json,
            tool_call_id, attachment_ids_json, provider_state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.eventId,
        input.conversationId,
        input.runId,
        input.role,
        input.content,
        JSON.stringify(input.toolCalls),
        input.toolCallId,
        JSON.stringify(input.attachmentIds),
        input.providerState === undefined ? null : JSON.stringify(input.providerState),
        input.createdAt,
      );
  }

  public touchConversation(conversationId: string, timestamp: string): void {
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(timestamp, conversationId);
  }

  public upsertModelRetryInTransaction(retry: ConversationModelRetryItem): void {
    const result = this.database
      .prepare(
        `INSERT INTO conversation_timeline
           (id, conversation_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, 'model_retry', ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
         WHERE conversation_timeline.conversation_id = excluded.conversation_id
           AND conversation_timeline.run_id = excluded.run_id
           AND conversation_timeline.kind = 'model_retry'`,
      )
      .run(
        retry.id,
        retry.conversationId,
        retry.runId,
        JSON.stringify(retry),
        retry.createdAt,
      );
    if (result.changes !== 1) {
      throw new Error("Model retry timeline identity conflicts with an existing item.");
    }
  }

  public updateRunInTransaction(
    runId: string,
    status: ConversationRunStatus,
    error: string | null,
  ): string {
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Run was not found.");
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    const conversationId = asString(row, "conversation_id");
    if (!RUN_STATUS_TRANSITIONS[currentStatus].includes(status)) {
      throw new Error(
        `Run state transition is not allowed: ${currentStatus} -> ${status}.`,
      );
    }
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(status, error, now, runId, currentStatus);
    if (result.changes !== 1) {
      throw new Error("Run state changed before the transition could be committed.");
    }
    this.database
      .prepare(
        "UPDATE conversations SET has_unread_result = ? WHERE id = (SELECT conversation_id FROM runs WHERE id = ?)"
      )
      .run(status === "completed" || status === "failed" ? 1 : 0, runId);
    return conversationId;
  }

  public markThreadLogToolAwaitingApproval(
    conversationId: string,
    toolId: string,
  ): void {
    const row = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .get(toolId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog tool approval has no matching Tool Call.");
    }
    const current = conversationToolItemSchema.parse(
      parseJson(asString(row, "payload_json"), "tool"),
    );
    if (current.status === "awaiting_approval") return;
    const awaiting = conversationToolItemSchema.parse({
      ...current,
      status: "awaiting_approval",
    });
    this.database
      .prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ?",
      )
      .run(JSON.stringify(awaiting), toolId);
  }

  public markThreadLogToolRunning(
    conversationId: string,
    tool: ConversationToolItem,
  ): void {
    if (tool.conversationId !== conversationId) {
      throw new Error("ThreadLog approved Tool Call belongs to another Conversation.");
    }
    const row = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .get(tool.id, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog tool approval decision has no matching Tool Call.");
    }
    const current = conversationToolItemSchema.parse(
      parseJson(asString(row, "payload_json"), "tool"),
    );
    if (current.status !== "awaiting_approval") return;
    this.database
      .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
      .run(JSON.stringify(tool), tool.id);
  }

  public expireThreadLogToolApproval(
    conversationId: string,
    tool: ConversationToolItem,
  ): void {
    const current = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .get(tool.id, conversationId) as DatabaseRow | undefined;
    if (current === undefined) return;
    const currentTool = conversationToolItemSchema.parse(
      parseJson(asString(current, "payload_json"), "tool"),
    );
    if (currentTool.status !== "awaiting_approval") return;
    this.database
      .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
      .run(JSON.stringify(tool), tool.id);
  }

  public expirePendingToolApprovalsForRunInTransaction(runId: string): ConversationToolItem[] {
    const rows = this.database.prepare(
      `SELECT payload_json FROM conversation_timeline
       WHERE kind = 'tool'`,
    ).all() as DatabaseRow[];
    const expired = rows.flatMap((row) => {
      const current = conversationToolItemSchema.parse(
        parseJson(asString(row, "payload_json"), "tool"),
      );
      if (current.runId !== runId || current.status !== "awaiting_approval") return [];
      const tool = conversationToolItemSchema.parse({
        ...current,
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      });
      this.database
        .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
        .run(JSON.stringify(tool), tool.id);
      this.touchConversation(tool.conversationId, new Date().toISOString());
      return [tool];
    });
    return expired;
  }

  public expirePendingToolApprovalsForTerminalRunsInTransaction(): void {
    const rows = this.database.prepare(
      `SELECT timeline.payload_json FROM conversation_timeline AS timeline
       JOIN runs ON runs.id = timeline.run_id
       WHERE timeline.kind = 'tool'
         AND runs.status IN ('completed', 'failed', 'cancelled')
         AND json_extract(timeline.payload_json, '$.status') = 'awaiting_approval'`,
    ).all() as DatabaseRow[];
    for (const row of rows) {
      const current = conversationToolItemSchema.parse(
        parseJson(asString(row, "payload_json"), "tool"),
      );
      const tool = conversationToolItemSchema.parse({
        ...current,
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      });
      this.database
        .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
        .run(JSON.stringify(tool), tool.id);
      this.touchConversation(tool.conversationId, new Date().toISOString());
    }
  }

  public interruptRunningToolsForTerminalRunsInTransaction(): void {
    const rows = this.database.prepare(
      `SELECT timeline.payload_json FROM conversation_timeline AS timeline
       JOIN runs ON runs.id = timeline.run_id
       WHERE timeline.kind = 'tool'
         AND runs.status IN ('completed', 'failed', 'cancelled')
         AND json_extract(timeline.payload_json, '$.status') = 'running'`,
    ).all() as DatabaseRow[];
    for (const row of rows) {
      const current = conversationToolItemSchema.parse(parseJson(asString(row, "payload_json"), "tool"));
      const tool = conversationToolItemSchema.parse({
        ...current, status: "failed",
        result: JSON.stringify({ ok: false, error: "执行已中断：所属运行已结束，未收到完成结果。不会在重启后自动重放。" }),
      });
      this.updateTool(tool);
    }
  }
}
