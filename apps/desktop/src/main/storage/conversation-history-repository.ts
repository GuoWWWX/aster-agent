import type { DatabaseSync } from "node:sqlite";
import { conversationTimelineItemSchema } from "@agent/protocol";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";
import type { StoredContextMessage } from "./conversation-storage-contracts.js";
import { type DatabaseRow, asString, asNullableString, asNumber, parseJson } from "./database-row.js";
import { contextSearchTerms, distinctiveContextTerms, likePattern, rankStrongContextMatches } from "./context-search.js";

/** Reads the model-history projection; the façade retains conversation/run identity checks. */
export class ConversationHistoryRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public listContextMessages(conversationId: string): StoredContextMessage[] {
    const rows = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE conversation_id = ?
         ORDER BY sequence ASC`
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => this.toStoredContextMessage(row));
  }

  public listAssistantProviderStates(conversationId: string): ModelProviderState[] {
    const rows = this.database
      .prepare(
        `SELECT provider_state_json
         FROM model_messages
         WHERE conversation_id = ?
           AND role = 'assistant'
           AND provider_state_json IS NOT NULL
         ORDER BY sequence ASC`,
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => parseJson<ModelProviderState>(
      asString(row, "provider_state_json"),
      "assistant provider state",
    ));
  }

  public listContextAttachmentIds(conversationId: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT attachment_ids_json
         FROM model_messages
         WHERE conversation_id = ? AND attachment_ids_json <> '[]'`,
      )
      .all(conversationId) as DatabaseRow[];
    return [...new Set(rows.flatMap((row) =>
      parseJson<unknown[]>(asString(row, "attachment_ids_json"), "context attachment ids")
        .filter((value): value is string => typeof value === "string")
    ))];
  }

  public getLatestConversationRequestContent(conversationId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT payload_json
         FROM conversation_timeline
         WHERE conversation_id = ?
           AND (
             kind = 'agent_message'
             OR (kind = 'message' AND json_extract(payload_json, '$.role') = 'user')
           )
         ORDER BY sequence DESC
         LIMIT 1`,
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const item = conversationTimelineItemSchema.parse(
      parseJson(asString(row, "payload_json"), "latest conversation request"),
    );
    return item.kind === "message" || item.kind === "agent_message" ? item.content : null;
  }

  public getLatestCompletedAssistantContent(conversationId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT payload_json
         FROM conversation_timeline
         WHERE conversation_id = ?
           AND kind = 'message'
           AND json_extract(payload_json, '$.role') = 'assistant'
           AND json_extract(payload_json, '$.status') = 'completed'
         ORDER BY sequence DESC
         LIMIT 1`,
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const item = conversationTimelineItemSchema.parse(
      parseJson(asString(row, "payload_json"), "latest assistant result"),
    );
    return item.kind === "message" && item.role === "assistant" ? item.content : null;
  }

  public listContextMessagesPage(input: {
    afterSequence?: number;
    beforeSequence?: number;
    conversationId: string;
    limit: number;
  }): StoredContextMessage[] {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
      throw new Error("Context message page limit must be between 1 and 1000.");
    }
    const afterSequence = input.afterSequence;
    const beforeSequence = input.beforeSequence;
    if (
      afterSequence !== undefined
      && (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
    ) {
      throw new Error("Context message afterSequence must be a non-negative safe integer.");
    }
    if (
      beforeSequence !== undefined
      && (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)
    ) {
      throw new Error("Context message beforeSequence must be a positive safe integer.");
    }
    const afterSql = afterSequence === undefined ? "" : " AND sequence > ?";
    const beforeSql = beforeSequence === undefined ? "" : " AND sequence < ?";
    const rows = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE conversation_id = ?${afterSql}${beforeSql}
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(
        input.conversationId,
        ...(afterSequence === undefined ? [] : [afterSequence]),
        ...(beforeSequence === undefined ? [] : [beforeSequence]),
        input.limit,
      ) as DatabaseRow[];
    return rows.reverse().map((row) => this.toStoredContextMessage(row));
  }

  public countContextMessages(input: {
    afterSequence?: number;
    beforeSequence?: number;
    conversationId: string;
  }): number {
    const afterSql = input.afterSequence === undefined ? "" : " AND sequence > ?";
    const beforeSql = input.beforeSequence === undefined ? "" : " AND sequence < ?";
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS message_count
         FROM model_messages
         WHERE conversation_id = ?${afterSql}${beforeSql}`,
      )
      .get(
        input.conversationId,
        ...(input.afterSequence === undefined ? [] : [input.afterSequence]),
        ...(input.beforeSequence === undefined ? [] : [input.beforeSequence]),
      ) as DatabaseRow;
    return asNumber(row, "message_count");
  }

  public getLatestContextUserMessage(conversationId: string): StoredContextMessage | null {
    const row = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toStoredContextMessage(row);
  }

  public resolveContextCheckpointSequence(
    conversationId: string,
    contextSequence: number,
  ): number {
    if (!Number.isSafeInteger(contextSequence) || contextSequence <= 0) {
      throw new Error("Context message sequence must be a positive integer.");
    }
    const row = this.database
      .prepare(
        `SELECT sequence FROM model_messages
         WHERE conversation_id = ?
         ORDER BY sequence ASC
         LIMIT 1 OFFSET ?`,
      )
      .get(conversationId, contextSequence - 1) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog checkpoint boundary has no stored database message.");
    }
    return asNumber(row, "sequence");
  }

  public searchContextMessages(input: {
    beforeSequence?: number;
    conversationId: string;
    excludeSequences?: readonly number[];
    limit?: number;
    query: string;
  }): StoredContextMessage[] {
    const terms = contextSearchTerms(input.query);
    const distinctiveTerms = distinctiveContextTerms(input.query);
    if (terms.length === 0) return [];
    const limit = input.limit ?? 24;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error("Context search limit must be between 1 and 100.");
    }
    const beforeSequence = input.beforeSequence;
    if (
      beforeSequence !== undefined
      && (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)
    ) {
      throw new Error("Context search beforeSequence must be a positive safe integer.");
    }
    const excluded = [...new Set(input.excludeSequences ?? [])].filter(
      (sequence) => Number.isSafeInteger(sequence) && sequence > 0,
    );
    const exclusionSql = excluded.length === 0
      ? ""
      : ` AND model_messages.sequence NOT IN (${excluded.map(() => "?").join(", ")})`;
    const beforeSql = beforeSequence === undefined
      ? ""
      : " AND model_messages.sequence < ?";
    const beforeParameters = beforeSequence === undefined ? [] : [beforeSequence];
    const candidateLimit = Math.min(100, Math.max(limit, limit * 4));
    const columns = `model_messages.sequence, model_messages.run_id, model_messages.role,
      model_messages.content, model_messages.tool_calls_json, model_messages.tool_call_id,
      model_messages.attachment_ids_json, model_messages.provider_state_json`;
    const searchableText = "(model_messages.content || char(10) || model_messages.tool_calls_json)";
    const likeConditions = terms.map(() => `${searchableText} LIKE ? ESCAPE '\\'`);
    const rows = this.database
      .prepare(
        `SELECT ${columns}
         FROM model_messages
         WHERE model_messages.conversation_id = ?
           AND (${likeConditions.join(" OR ")})
           ${beforeSql}
           ${exclusionSql}
         ORDER BY model_messages.sequence DESC
         LIMIT ?`,
      )
      .all(
        input.conversationId,
        ...terms.map(likePattern),
        ...beforeParameters,
        ...excluded,
        candidateLimit,
      ) as DatabaseRow[];
    return rankStrongContextMatches(
      rows.map((row) => this.toStoredContextMessage(row)),
      distinctiveTerms,
      terms,
      limit,
    );
  }

  public listContextMessagesForRun(runId: string): StoredContextMessage[] {
    const rows = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE run_id = ?
         ORDER BY sequence ASC`,
      )
      .all(runId) as DatabaseRow[];
    return rows.map((row) => this.toStoredContextMessage(row));
  }

  private toStoredContextMessage(row: DatabaseRow): StoredContextMessage {
    const role = asString(row, "role");
    if (role !== "user" && role !== "assistant" && role !== "tool") {
      throw new Error("Stored model message role is invalid.");
    }
    return {
      attachmentIds: parseJson<string[]>(
        asString(row, "attachment_ids_json"),
        "model message attachment identifiers"
      ),
      content: asString(row, "content"),
      ...(asNullableString(row, "provider_state_json") === null
        ? {}
        : {
            providerState: parseJson<ModelProviderState>(
              asString(row, "provider_state_json"),
              "model provider state"
            )
          }),
      role,
      runId: asNullableString(row, "run_id"),
      sequence: asNumber(row, "sequence"),
      toolCallId: asNullableString(row, "tool_call_id"),
      toolCalls: parseJson<ModelToolCall[]>(
        asString(row, "tool_calls_json"),
        "model tool calls"
      )
    };
  }
}
