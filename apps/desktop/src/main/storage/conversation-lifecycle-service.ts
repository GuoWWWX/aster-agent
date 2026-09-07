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
import { ThreadLog } from "./thread-log.js";

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

  public bindConversationAgent(
    conversationId: string,
    agent: ConversationAgentBinding,
  ): ConversationSummary {
    const currentAgent = this.database.getConversationAgentBinding(conversationId);
    if (JSON.stringify(currentAgent) === JSON.stringify(agent)) {
      return this.database.getConversation(conversationId);
    }
    return this.recordProperties(
      this.database.bindConversationAgent(conversationId, agent),
      ["agent", "avatar"],
    );
  }

  public setConversationAvatarIcon(
    conversationId: string,
    avatarIcon: unknown,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if ((current.avatarIcon ?? null) === avatarIcon) return current;
    return this.recordProperties(
      this.database.setConversationAvatarIcon(conversationId, avatarIcon),
      ["avatar"],
    );
  }

  public setConversationWorkspaceRoot(
    conversationId: string,
    rootPath: string | null,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.workspaceRootPath === rootPath) return current;
    return this.recordProperties(
      this.database.setConversationWorkspaceRoot(conversationId, rootPath),
      ["workspace"],
    );
  }

  public setConversationModelSelection(
    conversationId: string,
    selection: ConversationModelSelection,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (JSON.stringify(current.modelSelection) === JSON.stringify(selection)) return current;
    return this.recordProperties(
      this.database.setConversationModelSelection(conversationId, selection),
      ["modelSelection"],
    );
  }

  public setConversationPermissionMode(
    conversationId: string,
    permissionMode: ConversationPermissionMode,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.permissionMode === permissionMode) return current;
    return this.recordProperties(
      this.database.setConversationPermissionMode(conversationId, permissionMode),
      ["permissionMode"],
    );
  }

  public renameConversation(conversationId: string, title: string): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.title === title) return current;
    return this.recordProperties(
      this.database.renameConversation(conversationId, title),
      ["title"],
    );
  }

  public reorderConversations(conversationIds: readonly string[]): void {
    this.database.reorderConversations(conversationIds);
    for (const conversationId of conversationIds) {
      this.recordProperties(this.database.getConversation(conversationId), ["pin"]);
    }
  }

  public setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.projectId === projectId) return current;
    return this.recordProperties(
      this.database.setConversationProject(conversationId, projectId),
      ["project", "workspace"],
    );
  }

  public setConversationArchived(
    conversationId: string,
    archived: boolean,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.isArchived === archived) return current;
    return this.recordProperties(
      this.database.setConversationArchived(conversationId, archived),
      ["archive"],
    );
  }

  public setConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): ConversationSummary {
    const current = this.database.getConversation(conversationId);
    if (current.isPinned === pinned) return current;
    return this.recordProperties(
      this.database.setConversationPinned(conversationId, pinned),
      ["pin"],
    );
  }

  private recordProperties(
    conversation: ConversationSummary,
    changed: ConversationMutableProperty[],
  ): ConversationSummary {
    const payload = conversationPropertiesChangedPayloadSchema.parse({
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
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        workspaceRootPath: conversation.workspaceRootPath,
      },
    });
    const event = this.threadLog.append(conversation.id, {
      payload,
      type: "conversation_properties_changed",
    });
    this.eventProjector.projectBusinessEvent(conversation.id, event);
    return this.database.getConversation(conversation.id);
  }
}
