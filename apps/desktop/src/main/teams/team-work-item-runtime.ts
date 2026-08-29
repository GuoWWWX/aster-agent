import type {
  AgentDirectoryConfiguration,
  AcceptTeamWorkItemInput,
  ConversationAgentBinding,
  ConversationMessageItem,
  ConversationRunEvent,
  ListTeamWorkItemsInput,
  RequestTeamWorkItemReworkInput,
  SubmitTeamWorkItemInput,
  TeamWorkItemView,
} from "@agent/protocol";

import { AgentRuntime } from "../agent/agent-runtime.js";
import { ModelCredentialStore } from "../model/model-credential-store.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";

type RunEventEmitter = (event: ConversationRunEvent) => void;

/**
 * Coordinates durable Team WorkItems while delegating every model/tool loop to AgentRuntime.
 * One execution Conversation per WorkItem keeps concurrent requirements isolated and recoverable.
 */
export class TeamWorkItemRuntime {
  private readonly schedulingTeams = new Set<string>();

  public constructor(
    private readonly database: AgentDatabase,
    private readonly conversationLifecycle: ConversationLifecycleService,
    private readonly agentRuntime: AgentRuntime,
    private readonly credentials: ModelCredentialStore,
    private readonly projects: ProjectRegistry,
    private readonly agentDirectory: { getConfiguration(): AgentDirectoryConfiguration },
  ) {}

  public list(input: ListTeamWorkItemsInput): TeamWorkItemView[] {
    return this.database.listTeamWorkItems(input);
  }

  public submit(rawInput: SubmitTeamWorkItemInput, emit: RunEventEmitter): TeamWorkItemView {
    const modelSelection = rawInput.modelSelection === undefined
      ? this.credentials.getPreferredSelection()
      : this.credentials.resolveSelection(rawInput.modelSelection);
    if (modelSelection === null) {
      throw new Error("Configure a model before submitting a Team WorkItem.");
    }
    this.assertTeamCanAcceptWork(rawInput.teamId);
    this.projects.getProject(rawInput.projectId);
    const workItem = this.database.createTeamWorkItem(rawInput, modelSelection);
    void this.schedule(rawInput.teamId, emit);
    return workItem;
  }

  public resumeQueued(emit: RunEventEmitter): void {
    const teamIds = new Set(
      this.database.listTeamWorkItems({}).map((workItem) => workItem.teamId),
    );
    for (const teamId of teamIds) {
      void this.schedule(teamId, emit);
    }
  }

  public requestRework(
    input: RequestTeamWorkItemReworkInput,
    emit: RunEventEmitter,
  ): TeamWorkItemView {
    const workItem = this.database.getTeamWorkItem(input.workItemId);
    if (workItem.status !== "waiting_user" || workItem.executionConversationId === null) {
      throw new Error("Only a WorkItem waiting for user acceptance can be reworked.");
    }
    let updated: TeamWorkItemView | null = null;
    const submission = this.agentRuntime.sendMessage({
      content: this.createReworkPrompt(workItem, input.feedback),
      conversationId: workItem.executionConversationId,
      modelId: workItem.modelSelection.modelId,
      permissionMode: workItem.permissionMode,
      providerId: workItem.modelSelection.providerId,
      ...(workItem.modelSelection.reasoning === null
        ? {}
        : { reasoning: workItem.modelSelection.reasoning }),
    }, (event) => {
      if (event.type !== "run.finished") {
        emit(event);
        return;
      }
      this.finishRun(workItem.id, event, emit);
      emit(event);
    }, {
      allowManagedTeamWorkItemExecution: true,
      beforeRunScheduled: (accepted) => {
        updated = this.database.startTeamWorkItemRework(
          workItem.id,
          accepted.runId,
          input.feedback,
        );
      },
    });
    if (submission.kind !== "started") {
      throw new Error("A Team WorkItem waiting for acceptance cannot have a queued rework Run.");
    }
    if (updated === null) throw new Error("Team WorkItem rework Run was not persisted.");
    return updated;
  }

  public accept(input: AcceptTeamWorkItemInput): TeamWorkItemView {
    return this.database.acceptTeamWorkItem(input);
  }

  private schedule(teamId: string, emit: RunEventEmitter): void {
    if (this.schedulingTeams.has(teamId)) return;
    this.schedulingTeams.add(teamId);
    try {
      const directory = this.agentDirectory.getConfiguration();
      const team = directory.teams.find((candidate) => candidate.id === teamId && candidate.enabled);
      if (team === undefined) return;
      const activeCount = this.database.listTeamWorkItems({ teamId })
        .filter((item) => item.status === "running" || item.status === "reviewing")
        .length;
      const capacity = Math.max(0, team.maxWorkers - activeCount);
      const queued = this.database.listTeamWorkItems({ teamId })
        .filter((item) => item.status === "queued")
        .slice(0, capacity);
      for (const workItem of queued) {
        try {
          this.start(workItem, emit);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Team WorkItem could not start.";
          this.database.failTeamWorkItemBeforeRun(workItem.id, message);
        }
      }
    } finally {
      this.schedulingTeams.delete(teamId);
    }
  }

  private start(workItem: TeamWorkItemView, emit: RunEventEmitter): void {
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === workItem.teamId && candidate.enabled);
    if (team === undefined) throw new Error("The selected Team is not available.");
    const lead = directory.agents.find(
      (candidate) => candidate.id === team.leadAgentId && candidate.enabled,
    );
    if (lead === undefined) throw new Error("The Team Lead Agent is not available.");
    const member = team.memberConfigurations[lead.id];
    const agent: ConversationAgentBinding = {
      avatarIcon: lead.avatar.kind === "icon" ? lead.avatar.icon : null,
      id: lead.id,
      instructions: [lead.instructions, team.instructions, member?.instructions]
        .filter((value): value is string => value !== undefined && value.trim().length > 0)
        .join("\n\n")
        .slice(0, 20_000),
      isDefault: lead.isDefault,
      name: lead.name,
      role: member?.role.trim() || lead.role,
    };
    const conversation = this.conversationLifecycle.createConversation(workItem.projectId, {
      agent,
      modelSelection: workItem.modelSelection,
      teamId: workItem.teamId,
      threadKind: "agent",
    });
    this.database.renameConversation(conversation.id, `团队任务：${workItem.title}`.slice(0, 200));

    let started: TeamWorkItemView | null = null;
    const submission = this.agentRuntime.sendMessage({
      content: this.createExecutionPrompt(workItem),
      conversationId: conversation.id,
      modelId: workItem.modelSelection.modelId,
      permissionMode: workItem.permissionMode,
      providerId: workItem.modelSelection.providerId,
      ...(workItem.modelSelection.reasoning === null
        ? {}
        : { reasoning: workItem.modelSelection.reasoning }),
    }, (event) => {
      if (event.type !== "run.finished") {
        emit(event);
        return;
      }
      this.finishRun(workItem.id, event, emit);
      emit(event);
    }, {
      allowManagedTeamWorkItemExecution: true,
      beforeRunScheduled: (accepted) => {
        started = this.database.startTeamWorkItem(workItem.id, conversation.id, accepted.runId);
      },
    });
    if (submission.kind !== "started") {
      throw new Error("A new Team execution Conversation unexpectedly queued its first Run.");
    }
    if (started === null) throw new Error("Team WorkItem execution Run was not persisted.");
  }

  private assertTeamCanAcceptWork(teamId: string): void {
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === teamId && candidate.enabled);
    if (team === undefined) throw new Error("The selected Team is not available.");
    const lead = directory.agents.find((candidate) => candidate.id === team.leadAgentId && candidate.enabled);
    if (lead === undefined) throw new Error("The Team Lead Agent is not available.");
  }

  private finishRun(
    workItemId: string,
    event: Extract<ConversationRunEvent, { type: "run.finished" }>,
    emit: RunEventEmitter,
  ): void {
    const workItem = this.database.getTeamWorkItem(workItemId);
    const resultSummary = event.status === "completed" && workItem.executionConversationId !== null
      ? this.lastAssistantResult(workItem.executionConversationId)
      : null;
    this.database.finishTeamWorkItemRun({
      error: event.error,
      resultSummary,
      runId: event.runId,
      status: event.status,
      workItemId,
    });
    void this.schedule(workItem.teamId, emit);
  }

  private lastAssistantResult(conversationId: string): string | null {
    const message = this.database.listTimeline(conversationId)
      .filter((item): item is ConversationMessageItem =>
        item.kind === "message" && item.role === "assistant" && item.status === "completed")
      .at(-1);
    const content = message?.content.trim() ?? "";
    return content.length === 0 ? null : content.slice(0, 20_000);
  }

  private createExecutionPrompt(workItem: TeamWorkItemView): string {
    const criteria = workItem.acceptanceCriteria.length === 0
      ? "- 根据需求自行提炼可验证的验收条件。"
      : workItem.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
    return [
      `你正在负责团队工作项 ${workItem.id}：${workItem.title}`,
      "",
      "需求：",
      workItem.requirement,
      "",
      "验收条件：",
      criteria,
      "",
      "执行要求：",
      "1. 先检查当前项目事实；存在多个可观察步骤时创建并持续更新任务清单。",
      "2. 简单任务直接完成；只有独立调查、实现或复核确有收益时才使用团队成员 Subagent。",
      "3. 完成实际修改，并运行与改动相符的测试或检查。",
      "4. 在结束前做一次需求符合性与回归风险自检；发现问题立即修正。",
      "5. 最终回复列出完成内容、修改文件、验证结果、未决风险，并逐项对应验收条件。",
      "不要只给方案；在当前授权范围内把任务推进到可由用户验收的状态。",
    ].join("\n");
  }

  private createReworkPrompt(workItem: TeamWorkItemView, feedback: string): string {
    return [
      `团队工作项 ${workItem.id} 第 ${workItem.revision + 1} 轮返工。`,
      "",
      "用户反馈：",
      feedback,
      "",
      "重新检查现有项目状态和上一轮结果，只修改返工所需内容；完成后重新运行验证并给出新的验收摘要。",
    ].join("\n");
  }
}
