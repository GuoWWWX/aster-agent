import type { CreateConversationInput, ConversationSummary } from "@agent/protocol";

import { AgentDatabase } from "./agent-database.js";
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
  ) {}

  public createConversation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {},
  ): ConversationSummary {
    const creation = this.database.prepareConversationCreation(projectId, options);
    this.threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    this.eventProjector.projectConversation(creation.conversation.id);
    return this.database.getConversation(creation.conversation.id);
  }
}
