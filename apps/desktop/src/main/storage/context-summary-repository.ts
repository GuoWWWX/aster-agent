import type { DatabaseSync } from "node:sqlite";
import type { ConversationContextCheckpoint, ConversationTurnSummary } from "./conversation-storage-contracts.js";
import { type DatabaseRow, asString, asNumber } from "./database-row.js";

/** Stores summaries derived from source history; callers own durable JSONL events. */
export class ContextSummaryRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public getContextCheckpoint(conversationId: string): ConversationContextCheckpoint | null {
    const row = this.database
      .prepare(
        `SELECT conversation_id, covered_through_sequence, summary, created_at, updated_at
         FROM conversation_context_checkpoints
         WHERE conversation_id = ?`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      conversationId: asString(row, "conversation_id"),
      coveredThroughSequence: asNumber(row, "covered_through_sequence"),
      createdAt: asString(row, "created_at"),
      summary: asString(row, "summary"),
      updatedAt: asString(row, "updated_at")
    };
  }

  public prepareContextCheckpoint(
    conversationId: string,
    coveredThroughSequence: number,
    summary: string,
  ): ConversationContextCheckpoint {
    const normalizedSummary = summary.trim();
    if (!Number.isSafeInteger(coveredThroughSequence) || coveredThroughSequence <= 0) {
      throw new Error("Context checkpoint sequence must be a positive integer.");
    }
    if (normalizedSummary.length === 0 || normalizedSummary.length > 200_000) {
      throw new Error("Context checkpoint summary has an invalid length.");
    }
    const coveredMessage = this.database
      .prepare(
        "SELECT sequence FROM model_messages WHERE conversation_id = ? AND sequence = ?"
      )
      .get(conversationId, coveredThroughSequence) as DatabaseRow | undefined;
    if (coveredMessage === undefined) {
      throw new Error("Context checkpoint must end at a stored conversation message.");
    }
    const existing = this.getContextCheckpoint(conversationId);
    if (
      existing !== null &&
      coveredThroughSequence < existing.coveredThroughSequence
    ) {
      throw new Error("Context checkpoint coverage cannot move backwards.");
    }

    const now = new Date().toISOString();
    return {
      conversationId,
      coveredThroughSequence,
      createdAt: existing?.createdAt ?? now,
      summary: normalizedSummary,
      updatedAt: now,
    };
  }

  public projectPreparedContextCheckpoint(
    checkpoint: ConversationContextCheckpoint,
  ): ConversationContextCheckpoint {
    const normalizedSummary = checkpoint.summary.trim();
    if (!Number.isSafeInteger(checkpoint.coveredThroughSequence) || checkpoint.coveredThroughSequence <= 0) {
      throw new Error("Context checkpoint sequence must be a positive integer.");
    }
    if (normalizedSummary.length === 0 || normalizedSummary.length > 200_000) {
      throw new Error("Context checkpoint summary has an invalid length.");
    }
    const coveredMessage = this.database
      .prepare(
        "SELECT sequence FROM model_messages WHERE conversation_id = ? AND sequence = ?"
      )
      .get(checkpoint.conversationId, checkpoint.coveredThroughSequence) as DatabaseRow | undefined;
    if (coveredMessage === undefined) {
      throw new Error("Context checkpoint must end at a stored conversation message.");
    }
    const existing = this.getContextCheckpoint(checkpoint.conversationId);
    if (
      existing !== null
      && checkpoint.coveredThroughSequence < existing.coveredThroughSequence
    ) {
      throw new Error("Context checkpoint coverage cannot move backwards.");
    }
    this.database
      .prepare(
        `INSERT INTO conversation_context_checkpoints
           (conversation_id, covered_through_sequence, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           covered_through_sequence = excluded.covered_through_sequence,
           summary = excluded.summary,
           updated_at = excluded.updated_at`
      )
      .run(
        checkpoint.conversationId,
        checkpoint.coveredThroughSequence,
        normalizedSummary,
        checkpoint.createdAt,
        checkpoint.updatedAt,
      );
    return this.getContextCheckpoint(checkpoint.conversationId) ?? (() => {
      throw new Error("Context checkpoint could not be persisted.");
    })();
  }

  public getLatestConversationTurnSummary(
    conversationId: string,
    coveredThroughSequence: number,
  ): ConversationTurnSummary | null {
    if (!Number.isSafeInteger(coveredThroughSequence) || coveredThroughSequence <= 0) {
      throw new Error("Turn summary boundary must be a positive safe integer.");
    }
    const row = this.database
      .prepare(
        `SELECT conversation_id, run_id, covered_through_sequence, summary, created_at
         FROM conversation_turn_summaries
         WHERE conversation_id = ? AND covered_through_sequence <= ?
         ORDER BY covered_through_sequence DESC
         LIMIT 1`,
      )
      .get(conversationId, coveredThroughSequence) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      conversationId: asString(row, "conversation_id"),
      coveredThroughSequence: asNumber(row, "covered_through_sequence"),
      createdAt: asString(row, "created_at"),
      runId: asString(row, "run_id"),
      summary: asString(row, "summary"),
    };
  }

  public getConversationTurnSummary(runId: string): ConversationTurnSummary | null {
    const row = this.database
      .prepare(
        `SELECT conversation_id, run_id, covered_through_sequence, summary, created_at
         FROM conversation_turn_summaries
         WHERE run_id = ?`,
      )
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      conversationId: asString(row, "conversation_id"),
      coveredThroughSequence: asNumber(row, "covered_through_sequence"),
      createdAt: asString(row, "created_at"),
      runId: asString(row, "run_id"),
      summary: asString(row, "summary"),
    };
  }

  public saveConversationTurnSummary(input: {
    conversationId: string;
    coveredThroughSequence: number;
    runId: string;
    summary: string;
  }): ConversationTurnSummary {
    const summary = input.summary.trim();
    if (!Number.isSafeInteger(input.coveredThroughSequence) || input.coveredThroughSequence <= 0) {
      throw new Error("Turn summary boundary must be a positive safe integer.");
    }
    if (summary.length === 0 || summary.length > 100_000) {
      throw new Error("Turn summary has an invalid length.");
    }
    const boundary = this.database
      .prepare(
        `SELECT sequence FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND sequence = ?`,
      )
      .get(
        input.conversationId,
        input.runId,
        input.coveredThroughSequence,
      ) as DatabaseRow | undefined;
    if (boundary === undefined) {
      throw new Error("Turn summary boundary must belong to its Run.");
    }
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO conversation_turn_summaries
           (run_id, conversation_id, covered_through_sequence, summary, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           covered_through_sequence = excluded.covered_through_sequence,
           summary = excluded.summary`,
      )
      .run(
        input.runId,
        input.conversationId,
        input.coveredThroughSequence,
        summary,
        createdAt,
      );
    return this.getLatestConversationTurnSummary(
      input.conversationId,
      input.coveredThroughSequence,
    ) ?? (() => {
      throw new Error("Turn summary could not be persisted.");
    })();
  }
}
