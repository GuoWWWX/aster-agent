import type {
  AgentDirectoryConfiguration,
  AcceptTeamWorkItemInput,
  ConversationAgentBinding,
  ConversationModelSelection,
  ConversationMessageItem,
  ConversationRunEvent,
  ConversationSummary,
  GetTeamWorkItemExecutionInput,
  ListTeamWorkItemsInput,
  RequestTeamWorkItemReworkInput,
  SendConversationMessageInput,
  SubmitTeamWorkItemInput,
  UpdateTeamWorkItemInput,
  UpdateTeamWorkItemPermissionInput,
  TeamWorkItemExecutionView,
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
 * A source Conversation reuses one Team Lead and its member conversations; each WorkItem
 * remains an independent, serialized unit of scheduling and acceptance.
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

  public getExecution(input: GetTeamWorkItemExecutionInput): TeamWorkItemExecutionView {
    return this.database.getTeamWorkItemExecution(input.workItemId);
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

  public update(input: UpdateTeamWorkItemInput): TeamWorkItemView {
    return this.database.updateTeamWorkItem(input);
  }

  public updatePermission(input: UpdateTeamWorkItemPermissionInput): TeamWorkItemView {
    return this.database.updateTeamWorkItemPermission(input);
  }

  /**
   * A Team member still presents as a normal Conversation. The selected model
   * becomes the WorkItem policy for future Team Runs while the active Run keeps
   * its immutable execution snapshot.
   */
  public updateModelSelection(
    conversationId: string,
    rawSelection: ConversationModelSelection,
  ): ConversationSummary {
    const conversation = this.database.getConversation(conversationId);
    const workItem = this.database.getRunningTeamWorkItemByExecutionTreeConversation(conversationId)
      ?? (conversation.teamWorkItemId === null
        ? null
        : this.database.getTeamWorkItem(conversation.teamWorkItemId));
    if (workItem === null) {
      throw new Error("Only a Team WorkItem conversation can update its Team execution model.");
    }
    const selection = this.credentials.resolveSelection(rawSelection);
    return this.database.updateTeamWorkItemModelSelection(
      workItem.id,
      conversationId,
      selection,
    );
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
      if (event.type !== "run.finished" || event.conversationId !== workItem.executionConversationId) {
        emit(event);
        return;
      }
      this.finishRun(workItem.id, event, emit);
      emit(event);
    }, {
      allowManagedTeamWorkItemExecution: true,
      titleOverride: this.database.getConversation(workItem.executionConversationId).title,
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

  /**
   * Delivers a user's in-flight instruction to a Team member without creating
   * a standalone Run. The message is consumed as `steer` at the current Run's
   * next safe model/tool boundary and always retains the WorkItem policy.
   */
  public sendExecutionGuidance(
    input: SendConversationMessageInput,
    emit: RunEventEmitter,
  ) {
    const workItem = this.database.getRunningTeamWorkItemByExecutionTreeConversation(
      input.conversationId,
    );
    const conversation = this.database.getConversation(input.conversationId);
    if (workItem === null || conversation.activeRunId === null) {
      throw new Error("This Team member is not currently running. Use the WorkItem review controls to request rework.");
    }
    return this.agentRuntime.sendMessage({
      ...(input.attachmentIds === undefined ? {} : { attachmentIds: input.attachmentIds }),
      content: input.content,
      conversationId: input.conversationId,
      deliveryMode: "steer",
      modelId: workItem.modelSelection.modelId,
      permissionMode: workItem.permissionMode,
      providerId: workItem.modelSelection.providerId,
      ...(input.referencedConversationIds === undefined
        ? {}
        : { referencedConversationIds: input.referencedConversationIds }),
      ...(input.referencedProjectPaths === undefined
        ? {}
        : { referencedProjectPaths: input.referencedProjectPaths }),
      ...(workItem.modelSelection.reasoning === null
        ? {}
        : { reasoning: workItem.modelSelection.reasoning }),
    }, emit, {
      allowManagedTeamWorkItemExecution: true,
    });
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
        .filter((item) => item.status === "queued");
      let remainingCapacity = capacity;
      for (const workItem of queued) {
        if (remainingCapacity <= 0) break;
        const existingExecution = this.database.getTeamExecutionConversation({
          projectId: workItem.projectId,
          sourceConversationId: workItem.sourceConversationId,
          teamId: workItem.teamId,
        });
        if (
          existingExecution !== null
          && this.database.getRunningTeamWorkItemByExecutionConversation(existingExecution.id) !== null
        ) continue;
        try {
          this.start(workItem, emit);
          remainingCapacity -= 1;
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
    const agent = this.teamAgentBinding(lead.id, team, directory);
    let conversation = this.database.getTeamExecutionConversation({
      projectId: workItem.projectId,
      sourceConversationId: workItem.sourceConversationId,
      teamId: workItem.teamId,
    });
    if (conversation === null) {
      const created = this.conversationLifecycle.createConversation(workItem.projectId, {
        agent,
        modelSelection: workItem.modelSelection,
        ...(workItem.sourceConversationId === null
          ? {}
          : { parentConversationId: workItem.sourceConversationId }),
        teamId: workItem.teamId,
        threadKind: "team_lead",
      });
      conversation = this.database.bindTeamExecutionConversation({
        conversationId: created.id,
        projectId: workItem.projectId,
        sourceConversationId: workItem.sourceConversationId,
        teamId: workItem.teamId,
      });
      const executionTitle = `${agent.name} · ${team.name}`.slice(0, 200);
      this.database.renameConversation(conversation.id, executionTitle);
      conversation = this.database.getConversation(conversation.id);
    }
    this.ensureTeamMemberConversations(workItem, team, directory, conversation);
    this.database.reserveTeamWorkItemExecution(workItem.id, conversation.id);

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
      if (event.type !== "run.finished" || event.conversationId !== conversation.id) {
        emit(event);
        return;
      }
      this.finishRun(workItem.id, event, emit);
      emit(event);
    }, {
      allowManagedTeamWorkItemExecution: true,
      titleOverride: conversation.title,
      beforeRunScheduled: (accepted) => {
        started = this.database.startTeamWorkItem(workItem.id, conversation.id, accepted.runId);
      },
    });
    if (submission.kind !== "started") {
      throw new Error("A new Team execution Conversation unexpectedly queued its first Run.");
    }
    if (started === null) throw new Error("Team WorkItem execution Run was not persisted.");
    emit({
      conversation: this.database.getConversation(conversation.id),
      type: "conversation.updated",
    });
  }

  private ensureTeamMemberConversations(
    workItem: TeamWorkItemView,
    team: AgentDirectoryConfiguration["teams"][number],
    directory: AgentDirectoryConfiguration,
    leadConversation: ConversationSummary,
  ): void {
    const existingAgentIds = new Set(
      this.database.listTeamMemberConversations(leadConversation.id)
        .flatMap((conversation) => conversation.agentId === null ? [] : [conversation.agentId]),
    );
    for (const agentId of team.memberIds) {
      if (agentId === team.leadAgentId || existingAgentIds.has(agentId)) continue;
      const configured = directory.agents.find((candidate) => candidate.id === agentId && candidate.enabled);
      if (configured === undefined) continue;
      const binding = this.teamAgentBinding(agentId, team, directory);
      const created = this.conversationLifecycle.createConversation(workItem.projectId, {
        agent: binding,
        modelSelection: workItem.modelSelection,
        parentConversationId: leadConversation.id,
        teamId: team.id,
        threadKind: "agent",
      });
      this.database.renameConversation(
        created.id,
        `${binding.name} · ${team.name}`.slice(0, 200),
      );
      this.database.bindTeamMemberConversation({
        agentId,
        conversationId: created.id,
        teamExecutionConversationId: leadConversation.id,
      });
    }
  }

  private teamAgentBinding(
    agentId: string,
    team: AgentDirectoryConfiguration["teams"][number],
    directory: AgentDirectoryConfiguration,
  ): ConversationAgentBinding {
    const configured = directory.agents.find((candidate) => candidate.id === agentId && candidate.enabled);
    if (configured === undefined) throw new Error("The Team Agent is not available.");
    const member = team.memberConfigurations[configured.id];
    return {
      avatarIcon: configured.avatar.kind === "icon" ? configured.avatar.icon : null,
      id: configured.id,
      instructions: [configured.instructions, team.instructions, member?.instructions]
        .filter((value): value is string => value !== undefined && value.trim().length > 0)
        .join("\n\n")
        .slice(0, 20_000),
      isDefault: configured.isDefault,
      name: configured.name,
      role: member?.role.trim() || configured.role,
    };
  }

  private assertTeamCanAcceptWork(teamId: string): void {
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === teamId);
    if (team === undefined) throw new Error("The selected Team is not available.");
    if (!team.enabled) return;
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
      conversationId: event.conversationId,
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
      "2. 每个工作项都必须至少通过 send_agent_message 委派一位持久团队成员，并使用 expectReply=true 等待专业结果；不能由 Team Lead 独自完成。",
      "3. 简单任务走短路径：只选择一位最匹配的专业成员处理，Team Lead 验收后汇总，不强制跑完整团队流程。",
      "4. 常规或复杂任务再按实际需要组合需求、架构、前端、后端和测试角色；没有真实并行收益时不要同时唤醒所有成员。",
      "5. 成员的完成结果会以 Agent 消息返回；收到全部必要结果后再汇总，不能把成员对话当作一次性 Subagent。",
      "6. 完成实际修改，并运行与改动相符的测试或检查。",
      "7. 在结束前做一次需求符合性与回归风险自检；发现问题立即修正。",
      "8. 最终回复列出成员分工、完成内容、修改文件、验证结果、未决风险，并逐项对应验收条件。",
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
