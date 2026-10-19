import type { DatabaseSync } from "node:sqlite";
import { conversationAttachmentSchema, type ConversationAttachment } from "@agent/protocol";
import type { ConversationAttachmentStoragePaths, StoredConversationAttachment } from "./conversation-storage-contracts.js";
import { type DatabaseRow, asString, asNullableString } from "./database-row.js";
import { toConversationAttachment } from "./conversation-row-mappers.js";

/** Owns attachment metadata; file IO and cross-domain cleanup transactions stay with their lifecycle owners. */
export class ConversationAttachmentMetadataRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public hasToolImageOwner(conversationId: string, messageId: string): boolean {
    return this.database.prepare(
      "SELECT 1 FROM conversation_timeline WHERE id = ? AND conversation_id = ? AND kind = 'tool'",
    ).get(messageId, conversationId) !== undefined;
  }

  public listSent(conversationId: string): StoredConversationAttachment[] {
    return this.listStoredAttachments("conversation_id = ? AND message_id IS NOT NULL", [conversationId]);
  }

  public listUnbound(conversationId: string): StoredConversationAttachment[] {
    return this.listStoredAttachments(
      `conversation_id = ? AND message_id IS NULL AND pending_message_id IS NULL
       ORDER BY created_at ASC, rowid ASC`,
      [conversationId],
    );
  }

  public listCancelledPendingAttachments(
    conversationId: string,
    attachmentIds: readonly string[],
    pendingMessageId: string,
  ): StoredConversationAttachment[] {
    const placeholders = attachmentIds.map(() => "?").join(", ");
    return this.listStoredAttachments(
      `conversation_id = ? AND id IN (${placeholders})
         AND message_id IS NULL
         AND (pending_message_id = ? OR pending_message_id IS NULL)`,
      [conversationId, ...attachmentIds, pendingMessageId],
    );
  }

  public insertConversationAttachment(input: StoredConversationAttachment): ConversationAttachment {
    const validated = conversationAttachmentSchema.parse({
      contextTokens: input.contextTokens,
      conversationId: input.conversationId,
      createdAt: input.createdAt,
      id: input.id,
      kind: input.kind,
      messageId: input.messageId,
      mimeType: input.mimeType,
      name: input.name,
      projectPath: input.projectPath,
      sizeBytes: input.sizeBytes,
      source: input.source,
      truncated: input.truncated
    });
    this.database
      .prepare(
        `INSERT INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.messageId,
        validated.source,
        validated.kind,
        validated.name,
        validated.mimeType,
        validated.sizeBytes,
        validated.projectPath,
        input.storedPath,
        input.extractedTextPath,
        validated.contextTokens,
        Number(validated.truncated),
        validated.createdAt
      );
    return validated;
  }

  public getConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    const attachments = this.listStoredAttachments(
      "conversation_id = ? AND id = ?",
      [conversationId, attachmentId]
    );
    const attachment = attachments[0];
    if (attachment === undefined) {
      throw new Error("Conversation attachment was not found.");
    }
    return attachment;
  }

  public listConversationAttachmentsByIds(
    conversationId: string,
    attachmentIds: readonly string[]
  ): StoredConversationAttachment[] {
    if (attachmentIds.length === 0) return [];
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error("Conversation attachment list contains duplicates.");
    }
    const placeholders = attachmentIds.map(() => "?").join(", ");
    const attachments = this.listStoredAttachments(
      `conversation_id = ? AND id IN (${placeholders})`,
      [conversationId, ...attachmentIds]
    );
    const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    return attachmentIds.map((attachmentId) => {
      const attachment = byId.get(attachmentId);
      if (attachment === undefined) {
        throw new Error("Conversation attachment was not found.");
      }
      return attachment;
    });
  }

  public listConversationAttachmentStoragePaths(): ConversationAttachmentStoragePaths[] {
    const rows = this.database.prepare(
      `SELECT id, stored_path, extracted_text_path
       FROM conversation_attachments
       ORDER BY created_at ASC, rowid ASC`,
    ).all() as DatabaseRow[];
    return rows.map((row) => ({
      extractedTextPath: asNullableString(row, "extracted_text_path"),
      id: asString(row, "id"),
      storedPath: asString(row, "stored_path"),
    }));
  }

  public updateConversationAttachmentStoragePaths(input: {
    extractedTextPath: string | null;
    id: string;
    storedPath: string;
  }): void {
    const result = this.database.prepare(
      `UPDATE conversation_attachments
       SET stored_path = ?, extracted_text_path = ?
       WHERE id = ?`,
    ).run(input.storedPath, input.extractedTextPath, input.id);
    if (result.changes !== 1) {
      throw new Error("Conversation attachment storage path was not found.");
    }
  }

  public removeDraftConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    const attachment = this.getConversationAttachment(conversationId, attachmentId);
    if (attachment.messageId !== null || attachment.pendingMessageId !== null) {
      throw new Error("A sent or queued conversation attachment cannot be removed.");
    }
    const result = this.database
      .prepare(
        `DELETE FROM conversation_attachments
         WHERE conversation_id = ? AND id = ?
           AND message_id IS NULL AND pending_message_id IS NULL`
      )
      .run(conversationId, attachmentId);
    if (result.changes !== 1) {
      throw new Error("Conversation attachment was not found.");
    }
    return attachment;
  }

  public isConversationAttachmentFileReferencedByActiveConversation(filePath: string): boolean {
    return this.database
      .prepare(
        `SELECT 1 AS present FROM conversation_attachments
         JOIN conversations
           ON conversations.id = conversation_attachments.conversation_id
         WHERE conversations.deletion_pending = 0
           AND (stored_path = ? OR extracted_text_path = ?)
         LIMIT 1`
      )
      .get(filePath, filePath) !== undefined;
  }

  public isConversationAttachmentFileReferencedOutside(
    filePath: string,
    excludedAttachmentIds: readonly string[],
  ): boolean {
    if (excludedAttachmentIds.length === 0) {
      return this.database
        .prepare(
          `SELECT 1 AS present FROM conversation_attachments
           WHERE stored_path = ? OR extracted_text_path = ?
           LIMIT 1`,
        )
        .get(filePath, filePath) !== undefined;
    }
    const placeholders = excludedAttachmentIds.map(() => "?").join(", ");
    return this.database
      .prepare(
        `SELECT 1 AS present FROM conversation_attachments
         WHERE (stored_path = ? OR extracted_text_path = ?)
           AND id NOT IN (${placeholders})
         LIMIT 1`,
      )
      .get(filePath, filePath, ...excludedAttachmentIds) !== undefined;
  }

  private listStoredAttachments(
    whereClause: string,
    parameters: readonly (number | string | null)[]
  ): StoredConversationAttachment[] {
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, message_id, pending_message_id, source, kind, name, mime_type,
                size_bytes, project_path, stored_path, extracted_text_path,
                context_tokens, truncated, created_at
         FROM conversation_attachments
         WHERE ${whereClause}`
      )
      .all(...parameters) as DatabaseRow[];
    return rows.map(toConversationAttachment);
  }
}
