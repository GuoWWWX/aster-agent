import {
  conversationListResponseSchema, conversationMessageSubmissionSchema,
  conversationSummarySchema, conversationTimelinePageSchema, projectListResponseSchema, modelRuntimeStatusSchema,
  type ConversationRunEvent, type LocalControlCommand,
} from "@agent/protocol";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import type { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import type { AgentDatabase } from "../storage/agent-database.js";
import type { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import type { EventProjector } from "../storage/event-projector.js";
import type { TeamWorkItemRuntime } from "../teams/team-work-item-runtime.js";
import type { ModelCredentialStore } from "../model/model-credential-store.js";

/** Local clients use the same lifecycle, permissions and execution core as IPC. */
export class ConversationControl {
  public constructor(
    private readonly database: Pick<AgentDatabase, "listProjects" | "listConversationHierarchy" | "getConversation" | "isTeamWorkItemExecutionTreeConversation">,
    private readonly lifecycle: Pick<ConversationLifecycleService, "createConversation" | "setConversationPermissionMode" | "setConversationModelSelection">,
    private readonly runtime: Pick<AgentRuntime, "sendMessage" | "cancelConversation">,
    private readonly projector: Pick<EventProjector, "prepareTimeline" | "listTimelinePage">,
    private readonly settings: Pick<ApplicationSettingsStore, "getConfiguration">,
    private readonly teams: Pick<TeamWorkItemRuntime, "sendExecutionGuidance">,
    private readonly emit: (event: ConversationRunEvent) => void,
    private readonly models: Pick<ModelCredentialStore, "saveConfiguration" | "resolveSelection">,
  ) {}

  public async execute(command: LocalControlCommand): Promise<unknown> {
    switch (command.command) {
      case "projects.list": return projectListResponseSchema.parse(this.database.listProjects());
      case "conversations.list": return conversationListResponseSchema.parse(this.database.listConversationHierarchy());
      case "models.configure": return modelRuntimeStatusSchema.parse(this.models.saveConfiguration(command.input));
      case "conversations.open": {
        const conversation = conversationSummarySchema.parse(this.database.getConversation(command.input.conversationId));
        if (conversation.isArchived || this.database.isTeamWorkItemExecutionTreeConversation(conversation.id)) {
          throw new Error("Only active ordinary conversations can be opened through local control.");
        }
        this.emit({ type: "conversation.open_requested", conversation });
        return { requested: true };
      }
      case "conversations.create": {
        const configuration = this.settings.getConfiguration();
        const profile = configuration.agentDirectory.agents.find((agent) =>
          command.input.agentId === undefined ? agent.isDefault : agent.id === command.input.agentId);
        if (profile === undefined || !profile.enabled) throw new Error("Configured Agent is unavailable.");
        const selection = command.input.modelSelection === undefined ? undefined : this.models.resolveSelection(command.input.modelSelection);
        const conversation = this.lifecycle.createConversation(command.input.projectId ?? null, { agent: {
          id: profile.id, name: profile.name, role: profile.role, instructions: profile.instructions,
          isDefault: profile.isDefault, avatarIcon: profile.avatar.kind === "icon" ? profile.avatar.icon : null,
        } });
        this.lifecycle.setConversationPermissionMode(conversation.id, configuration.general.defaultPermissionMode);
        if (selection !== undefined) this.lifecycle.setConversationModelSelection(conversation.id, selection);
        const summary = conversationSummarySchema.parse(this.database.getConversation(conversation.id));
        this.emit({ type: "conversation.updated", conversation: summary });
        return summary;
      }
      case "conversations.read":
        await this.projector.prepareTimeline(command.input.conversationId);
        return conversationTimelinePageSchema.parse(this.projector.listTimelinePage(command.input));
      case "messages.send": {
        const conversation = this.database.getConversation(command.input.conversationId);
        const selection = conversation.modelSelection;
        const input = { ...command.input,
          permissionMode: conversation.permissionMode ?? this.settings.getConfiguration().general.defaultPermissionMode,
          deliveryMode: command.input.deliveryMode ?? this.settings.getConfiguration().general.defaultMessageDeliveryMode,
          ...(selection === null ? {} : { providerId: selection.providerId, modelId: selection.modelId,
            ...(selection.reasoning === null ? {} : { reasoning: selection.reasoning }) }),
        };
        return conversationMessageSubmissionSchema.parse(
          this.database.isTeamWorkItemExecutionTreeConversation(conversation.id)
            ? this.teams.sendExecutionGuidance(input, this.emit)
            : this.runtime.sendMessage(input, this.emit),
        );
      }
      case "runs.cancel":
        this.runtime.cancelConversation(command.input.conversationId);
        return { cancelled: true };
    }
  }
}
