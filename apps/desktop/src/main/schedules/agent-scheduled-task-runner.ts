import type { ConversationRunEvent, SaveScheduledTaskInput, ScheduledTask } from "@agent/protocol";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import type { ProjectRegistry } from "../projects/project-registry.js";
import type { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import type { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import type { AgentDatabase } from "../storage/agent-database.js";
import { scheduledTaskError, type ScheduledTaskRunner } from "./scheduled-task-controller.js";

export class AgentScheduledTaskRunner implements ScheduledTaskRunner {
  public constructor(private readonly lifecycle: ConversationLifecycleService, private readonly runtime: AgentRuntime,
    private readonly database: AgentDatabase, private readonly projects: ProjectRegistry,
    private readonly settings: ApplicationSettingsStore) {}
  public validate(task: SaveScheduledTaskInput): void {
    if (task.projectId !== null && !this.projects.listProjects().some((project) => project.id === task.projectId)) throw scheduledTaskError("ARTIFACT_NOT_FOUND", "项目不存在。");
    this.agent(task);
  }
  private agent(task: SaveScheduledTaskInput) {
    const agents = this.settings.getConfiguration().agentDirectory.agents;
    const agent = agents.find((item) => task.agentId === null ? item.isDefault : item.id === task.agentId);
    if (agent === undefined || !agent.enabled) throw scheduledTaskError("VALIDATION_FAILED", "执行 Agent 不存在或已禁用。");
    return agent;
  }
  public createConversation(task: ScheduledTask): string {
    const profile = this.agent(task);
    const conversation = this.lifecycle.createConversation(task.projectId, { agent: {
      id: profile.id, name: profile.name, instructions: profile.instructions, role: profile.role,
      isDefault: profile.isDefault, avatarIcon: profile.avatar.kind === "icon" ? profile.avatar.icon : null,
    } });
    this.lifecycle.renameConversation(conversation.id, `定时 · ${task.name}`);
    return conversation.id;
  }
  public start(task: ScheduledTask, conversationId: string, accepted: (runId: string) => void,
    emit: (event: ConversationRunEvent) => void): void {
    const selection = this.database.getConversation(conversationId).modelSelection;
    this.runtime.sendMessage({ conversationId, content: task.prompt, permissionMode: task.permissionMode,
      ...(selection === null ? {} : { providerId: selection.providerId, modelId: selection.modelId,
        ...(selection.reasoning === null ? {} : { reasoning: selection.reasoning }) }),
    }, emit, {
      titleOverride: `定时 · ${task.name}`, beforeRunScheduled: (run) => accepted(run.runId),
    });
  }
  public outcome(conversationId: string, runId: string) {
    return this.database.getConversationRunOutcome(conversationId, runId)?.status ?? null;
  }
}
