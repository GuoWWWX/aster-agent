import type {
  ConversationAgentBinding,
  ConversationModelSelection,
  ConversationPermissionMode,
  CreateConversationInput,
  ConversationSummary,
} from "@agent/protocol";

import { AgentDatabase } from "./agent-database.js";
import {
  conversationPropertiesChangedPayloadSchema,
  type ConversationMutableProperty,
} from "./conversation-properties-event.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog, type ThreadLogEvent } from "./thread-log.js";

/**
 * Root Conversation creation is the first canonical-write migration seam:
 * prepare deterministically, append JSONL, then project it into SQLite.
 */
export class ConversationLifecycleService {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly threadLog: ThreadLog,
    private readonly eventProjector: EventProjector,
    private readonly modelSelectionProvider: {
      getPreferredSelection(): ConversationModelSelection | null;
    } | null = null,
  ) {}

  public createConversation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {},
  ): ConversationSummary {
    const preferredSelection = options.modelSelection
      ?? this.modelSelectionProvider?.getPreferredSelection()
      ?? undefined;
    const creation = this.database.prepareConversationCreation(projectId, {
      ...options,
      ...(preferredSelection === undefined ? {} : { modelSelection: preferredSelection }),
    });
    this.threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    this.eventProjector.projectConversation(creation.conversation.id);
    return this.database.getConversation(creation.conversation.id);
  }

  public markConversationResultViewed(conversationId: string): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (!current.hasUnreadResult) return current;
    const event = this.threadLog.append(conversationId, {
      type: "conversation_result_viewed",
      payload: {},
    });
    this.eventProjector.projectBusinessEvent(conversationId, event);
    return this.database.getConversation(conversationId);
  }

  public bindConversationAgent(
    conversationId: string,
    agent: ConversationAgentBinding,
  ): ConversationSummary {
    const currentAgent = this.database.getConversationAgentBinding(conversationId);
    if (JSON.stringify(currentAgent) === JSON.stringify(agent)) {
      return this.database.getConversation(conversationId);
    }
    return this.mutateAndRecord(
      conversationId,
      ["agent", "avatar"],
      () => this.database.bindConversationAgent(conversationId, agent),
    );
  }

  public setConversationAvatarIcon(
    conversationId: string,
    avatarIcon: unknown,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if ((current.avatarIcon ?? null) === avatarIcon) return current;
    return this.mutateAndRecord(
      conversationId,
      ["avatar"],
      () => this.database.setConversationAvatarIcon(conversationId, avatarIcon),
    );
  }

  public setConversationWorkspaceRoot(
    conversationId: string,
    rootPath: string | null,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.workspaceRootPath === rootPath) return current;
    return this.mutateAndRecord(
      conversationId,
      ["workspace"],
      () => this.database.setConversationWorkspaceRoot(conversationId, rootPath),
    );
  }

  public setConversationModelSelection(
    conversationId: string,
    selection: ConversationModelSelection,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (JSON.stringify(current.modelSelection) === JSON.stringify(selection)) return current;
    return this.mutateAndRecord(
      conversationId,
      ["modelSelection"],
      () => this.database.setConversationModelSelection(conversationId, selection),
    );
  }

  public setConversationPermissionMode(
    conversationId: string,
    permissionMode: ConversationPermissionMode,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.permissionMode === permissionMode) return current;
    return this.mutateAndRecord(
      conversationId,
      ["permissionMode"],
      () => this.database.setConversationPermissionMode(conversationId, permissionMode),
    );
  }

  public renameConversation(conversationId: string, title: string): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.title === title) return current;
    return this.mutateAndRecord(
      conversationId,
      ["title"],
      () => this.database.renameConversation(conversationId, title),
    );
  }

  public reorderConversations(conversationIds: readonly string[]): void {
    const previous = conversationIds.map((conversationId) => this.createPropertiesPayload(
      this.database.getConversation(conversationId),
      ["pin"],
    ));
    this.database.reorderConversations(conversationIds);
    const desired = conversationIds.map((conversationId) => this.createPropertiesPayload(
      this.database.getConversation(conversationId),
      ["pin"],
    ));
    previous.forEach((payload, index) => {
      const conversationId = conversationIds[index];
      if (conversationId !== undefined) {
        this.database.restoreConversationPropertySnapshot(conversationId, payload);
      }
    });

    const appended: Array<{
      conversationId: string;
      event: ThreadLogEvent;
      index: number;
    }> = [];
    try {
      for (const [index, conversationId] of conversationIds.entries()) {
        const payload = desired[index];
        if (payload === undefined) continue;
        appended.push({
          conversationId,
          event: this.threadLog.append(conversationId, {
            payload,
            type: "conversation_properties_changed",
          }),
          index,
        });
      }
    } catch (error) {
      const compensationErrors: unknown[] = [];
      for (const record of appended) {
        const payload = previous[record.index];
        if (payload === undefined) continue;
        try {
          this.threadLog.append(record.conversationId, {
            payload,
            type: "conversation_properties_changed",
          });
        } catch (compensationError) {
          compensationErrors.push(compensationError);
        }
      }
      if (compensationErrors.length > 0) {
        throw new AggregateError(
          [error, ...compensationErrors],
          "Conversation reorder failed before every durable property event was written.",
          { cause: error },
        );
      }
      throw new Error(
        error instanceof Error ? error.message : "Conversation property write failed.",
        { cause: error },
      );
    }
    for (const record of appended) {
      this.eventProjector.projectBusinessEvent(record.conversationId, record.event);
    }
  }

  public setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.projectId === projectId) return current;
    return this.mutateAndRecord(
      conversationId,
      ["project", "workspace"],
      () => this.database.setConversationProject(conversationId, projectId),
    );
  }

  public setConversationArchived(
    conversationId: string,
    archived: boolean,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.isArchived === archived) return current;
    return this.mutateAndRecord(
      conversationId,
      ["archive"],
      () => this.database.setConversationArchived(conversationId, archived),
    );
  }

  public setConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.isPinned === pinned) return current;
    return this.mutateAndRecord(
      conversationId,
      ["pin"],
      () => this.database.setConversationPinned(conversationId, pinned),
    );
  }

  private mutateAndRecord(
    conversationId: string,
    changed: ConversationMutableProperty[],
    mutate: () => ConversationSummary,
  ): ConversationSummary {
    const previous = this.createPropertiesPayload(
      this.database.getConversation(conversationId),
      changed,
    );
    const conversation = mutate();
    try {
      return this.recordProperties(conversation, changed);
    } catch (error) {
      try {
        this.database.restoreConversationPropertySnapshot(conversationId, previous);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Conversation property write failed and its volatile projection could not be restored.",
          { cause: restoreError },
        );
      }
      throw new Error(
        error instanceof Error ? error.message : "Conversation property write failed.",
        { cause: error },
      );
    }
  }

  private recordProperties(
    conversation: ConversationSummary,
    changed: ConversationMutableProperty[],
  ): ConversationSummary {
    const payload = this.createPropertiesPayload(conversation, changed);
    const event = this.threadLog.append(conversation.id, {
      payload,
      type: "conversation_properties_changed",
    });
    this.eventProjector.projectBusinessEvent(conversation.id, event);
    return this.database.getConversation(conversation.id);
  }

  private createPropertiesPayload(
    conversation: ConversationSummary,
    changed: ConversationMutableProperty[],
  ) {
    return conversationPropertiesChangedPayloadSchema.parse({
      agent: this.database.getConversationAgentBinding(conversation.id),
      changed,
      properties: {
        agentId: conversation.agentId,
        archivedAt: conversation.archivedAt,
        avatarIcon: conversation.avatarIcon ?? null,
        isArchived: conversation.isArchived,
        isPinned: conversation.isPinned,
        modelSelection: conversation.modelSelection,
        permissionMode: conversation.permissionMode ?? "ask_before_changes",
        pinOrder: conversation.pinOrder ?? null,
        projectId: conversation.projectId,
        sortOrder: this.database.getConversationSortOrder(conversation.id),
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        workspaceRootPath: conversation.workspaceRootPath,
      },
    });
  }
}
