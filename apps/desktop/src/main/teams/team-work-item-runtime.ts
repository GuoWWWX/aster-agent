import type {
  AgentDirectoryConfiguration,
  AcceptTeamWorkItemInput,
  ConversationAgentBinding,
  ConversationModelSelection,
  ConversationMessageItem,
  ConversationRunEvent,
  ConversationSummary,
  CreateTeamInstanceInput,
  EnsureTeamMemberConversationInput,
  GetTeamWorkItemExecutionInput,
  GetTeamCollaborationProjectionInput,
  ListTeamWorkItemsInput,
  RenameTeamInstanceInput,
  RequestTeamWorkItemReworkInput,
  SendConversationMessageInput,
  SubmitTeamWorkItemInput,
  UpdateTeamWorkItemInput,
  UpdateTeamWorkItemPermissionInput,
  TeamWorkItemExecutionView,
  TeamCollaborationProjection,
  TeamMemberConversationView,
  TeamInstanceView,
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
 * A project reuses one Team Lead and its member conversations by default. Explicit
 * conversation isolation keeps a separate execution tree for that source Conversation.
 * Each WorkItem remains an independent, serialized unit of scheduling and acceptance.
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

  public listInstances(): TeamInstanceView[] {
    return this.database.listTeamInstances({ includeArchived: false });
  }

  public createInstance(input: CreateTeamInstanceInput): TeamInstanceView {
    const instance = this.database.createTeamInstance(input);
    try {
      return this.provisionTeamInstance(instance);
    } catch (error) {
      this.database.deleteTeamInstance(instance.id);
      throw error;
    }
  }

  public renameInstance(input: RenameTeamInstanceInput): TeamInstanceView {
    const instance = this.database.renameTeamInstance(input);
    this.renameTeamInstanceConversations(instance);
    return instance;
  }

  public setInstanceArchived(input: {
    archived: boolean;
    teamInstanceId: string;
  }): TeamInstanceView {
    return this.database.setTeamInstanceArchived(input);
  }

  public deleteInstance(teamInstanceId: string): void {
    this.database.deleteTeamInstance(teamInstanceId);
  }

  public ensureInstanceMemberConversation(input: {
    agentId: string;
    teamInstanceId: string;
  }): TeamMemberConversationView {
    const instance = this.database.getTeamInstance(input.teamInstanceId);
    if (instance.isArchived || instance.rootConversationId === null) {
      throw new Error("The selected Team instance is unavailable.");
    }
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find(
      (candidate) => candidate.id === instance.teamId,
    );
    if (team === undefined || !team.memberIds.includes(input.agentId)) {
      throw new Error("The selected Agent is not a member of this Team instance.");
    }
    let lead = this.database.getConversation(instance.rootConversationId);
    const leadAgent = this.teamAgentBinding(team.leadAgentId, team, directory);
    const expectedLeadTitle = `${leadAgent.name} · ${instance.name}`.slice(0, 200);
    if (lead.title !== expectedLeadTitle) {
      lead = this.database.renameConversation(lead.id, expectedLeadTitle);
    }
    if (input.agentId === team.leadAgentId) return { lead, member: lead };
    let member = this.database.listTeamMemberConversations(lead.id)
      .find((conversation) => conversation.agentId === input.agentId);
    if (member === undefined) throw new Error("The Team member conversation is unavailable.");
    const memberAgent = this.teamAgentBinding(input.agentId, team, directory);
    const expectedMemberTitle = `${memberAgent.name} · ${instance.name}`.slice(0, 200);
    if (member.title !== expectedMemberTitle) {
      member = this.database.renameConversation(member.id, expectedMemberTitle);
    }
    return { lead, member };
  }

  public getExecution(input: GetTeamWorkItemExecutionInput): TeamWorkItemExecutionView {
    return this.database.getTeamWorkItemExecution(input.workItemId);
  }

  public getCollaborationProjection(
    input: GetTeamCollaborationProjectionInput,
  ): TeamCollaborationProjection {
    return this.database.getTeamCollaborationProjection(input.workItemId);
  }

  public ensureSharedMemberConversation(
    input: EnsureTeamMemberConversationInput,
  ): TeamMemberConversationView {
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === input.teamId);
    if (team === undefined) throw new Error("The selected Team is not available.");
    if (!team.memberIds.includes(input.agentId)) {
      throw new Error("The selected Agent is not a member of this Team.");
    }

    const leadAgent = this.teamAgentBinding(team.leadAgentId, team, directory);
    const coordinatorId = this.database.getTeamCoordinatorConversationId(team.id);
    let lead = coordinatorId === null
      ? this.database.listConversations().find((conversation) =>
          conversation.projectId === null
          && conversation.parentConversationId === null
          && conversation.teamId === team.id
          && conversation.threadKind === "team_lead"
        ) ?? null
      : this.database.getConversation(coordinatorId);

    if (lead === null) {
      const created = this.conversationLifecycle.createConversation(null, {
        agent: leadAgent,
        teamId: team.id,
        threadKind: "team_lead",
      });
      lead = this.database.renameConversation(
        created.id,
        `${leadAgent.name} · ${team.name}`.slice(0, 200),
      );
    } else if (lead.isArchived) {
      lead = this.database.setConversationArchived(lead.id, false);
    }
    this.database.setTeamCoordinatorConversation(team.id, lead.id);

    if (input.agentId === team.leadAgentId) {
      return { lead, member: lead };
    }

    let member = this.database.listTeamMemberConversations(lead.id)
      .find((conversation) => conversation.agentId === input.agentId) ?? null;
    if (member === null) {
      const existingChild = this.database.listConversationForks(lead.id).find((conversation) =>
        conversation.agentId === input.agentId
        && conversation.teamId === team.id
        && conversation.threadKind === "agent"
      );
      if (existingChild !== undefined) {
        member = this.database.bindTeamMemberConversation({
          agentId: input.agentId,
          conversationId: existingChild.id,
          teamExecutionConversationId: lead.id,
        });
      } else {
        const memberAgent = this.teamAgentBinding(input.agentId, team, directory);
        const created = this.conversationLifecycle.createConversation(null, {
          agent: memberAgent,
          ...(lead.modelSelection === null ? {} : { modelSelection: lead.modelSelection }),
          parentConversationId: lead.id,
          teamId: team.id,
          threadKind: "agent",
        });
        const renamed = this.database.renameConversation(
          created.id,
          `${memberAgent.name} · ${team.name}`.slice(0, 200),
        );
        member = this.database.bindTeamMemberConversation({
          agentId: input.agentId,
          conversationId: renamed.id,
          teamExecutionConversationId: lead.id,
        });
      }
    }
    if (member.isArchived) {
      member = this.database.setConversationArchived(member.id, false);
    }
    return { lead, member };
  }

  private provisionTeamInstance(instance: TeamInstanceView): TeamInstanceView {
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === instance.teamId);
    if (team === undefined) throw new Error("The selected Team template is not available.");
    const leadAgent = this.teamAgentBinding(team.leadAgentId, team, directory);
    const created = this.conversationLifecycle.createConversation(instance.projectId, {
      agent: leadAgent,
      ...(instance.sourceConversationId === null
        ? {}
        : { parentConversationId: instance.sourceConversationId }),
      teamId: team.id,
      threadKind: "team_lead",
    });
    const lead = this.database.renameConversation(
      created.id,
      `${leadAgent.name} · ${instance.name}`.slice(0, 200),
    );
    const saved = this.database.setTeamInstanceRoot(instance.id, lead.id);
    if (saved.scope !== "global") {
      this.database.bindTeamExecutionConversation({
        conversationId: lead.id,
        projectId: saved.projectId!,
        sourceConversationId: saved.sourceConversationId,
        teamId: saved.teamId,
        teamInstanceId: saved.id,
      });
    }
    this.ensureConfiguredTeamMemberConversations({
      directory,
      instanceName: saved.name,
      leadConversation: lead,
      modelSelection: lead.modelSelection,
      projectId: saved.projectId,
      team,
    });
    return this.database.getTeamInstance(saved.id);
  }

  private renameTeamInstanceConversations(instance: TeamInstanceView): void {
    if (instance.rootConversationId === null) return;
    const directory = this.agentDirectory.getConfiguration();
    const team = directory.teams.find((candidate) => candidate.id === instance.teamId);
    if (team === undefined) return;
    const lead = this.database.getConversation(instance.rootConversationId);
    const leadName = lead.agentId === null
      ? "Team Lead"
      : directory.agents.find((agent) => agent.id === lead.agentId)?.name ?? "Team Lead";
    this.database.renameConversation(lead.id, `${leadName} · ${instance.name}`.slice(0, 200));
    for (const member of this.database.listTeamMemberConversations(lead.id)) {
      const memberName = member.agentId === null
        ? "Agent"
        : directory.agents.find((agent) => agent.id === member.agentId)?.name ?? "Agent";
      this.database.renameConversation(member.id, `${memberName} · ${instance.name}`.slice(0, 200));
    }
  }

  private validateSubmissionTeamInstance(rawInput: SubmitTeamWorkItemInput): TeamInstanceView {
    if (rawInput.teamInstanceId === undefined) {
      throw new Error("Select an existing Team instance before submitting work.");
    }
    const selected = this.database.getTeamInstance(rawInput.teamInstanceId);
    if (selected.isArchived) throw new Error("The selected Team instance is archived.");
    if (selected.teamId !== rawInput.teamId) {
      throw new Error("The selected Team instance does not match the Team template.");
    }
    if (selected.scope === "conversation") {
      if (
        rawInput.executionScope !== "conversation"
        || rawInput.sourceConversationId !== selected.sourceConversationId
        || rawInput.projectId !== selected.projectId
      ) {
        throw new Error("The selected conversation Team belongs to another conversation.");
      }
      return selected;
    }
    if (rawInput.executionScope === "conversation") {
      throw new Error("Create and select a conversation Team instance before isolated work.");
    }
    if (selected.scope === "project" && selected.projectId !== rawInput.projectId) {
      throw new Error("The selected project Team belongs to another project.");
    }
    return selected;
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
    this.validateSubmissionTeamInstance(rawInput);
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
        const executionSourceConversationId = this.executionSourceConversationId(workItem);
        const existingExecution = this.database.getTeamExecutionConversation({
          projectId: workItem.projectId,
          sourceConversationId: executionSourceConversationId,
          teamId: workItem.teamId,
          ...(workItem.teamInstanceId === undefined
            ? {}
            : { teamInstanceId: workItem.teamInstanceId }),
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
    const executionSourceConversationId = this.executionSourceConversationId(workItem);
    let conversation = this.database.getTeamExecutionConversation({
      projectId: workItem.projectId,
      sourceConversationId: executionSourceConversationId,
      teamId: workItem.teamId,
      ...(workItem.teamInstanceId === undefined
        ? {}
        : { teamInstanceId: workItem.teamInstanceId }),
    });
    if (conversation === null) {
      const created = this.conversationLifecycle.createConversation(workItem.projectId, {
        agent,
        modelSelection: workItem.modelSelection,
        ...(executionSourceConversationId === null
          ? {}
          : { parentConversationId: executionSourceConversationId }),
        teamId: workItem.teamId,
        threadKind: "team_lead",
      });
      conversation = this.database.bindTeamExecutionConversation({
        conversationId: created.id,
        projectId: workItem.projectId,
        sourceConversationId: executionSourceConversationId,
        teamId: workItem.teamId,
        ...(workItem.teamInstanceId === undefined
          ? {}
          : { teamInstanceId: workItem.teamInstanceId }),
      });
      const executionTitle = `${agent.name} · ${workItem.instanceName ?? team.name}`.slice(0, 200);
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
    this.ensureConfiguredTeamMemberConversations({
      directory,
      instanceName: workItem.instanceName ?? team.name,
      leadConversation,
      modelSelection: workItem.modelSelection,
      projectId: workItem.projectId,
      team,
    });
  }

  private ensureConfiguredTeamMemberConversations(input: {
    directory: AgentDirectoryConfiguration;
    instanceName: string;
    leadConversation: ConversationSummary;
    modelSelection: ConversationModelSelection | null;
    projectId: string | null;
    team: AgentDirectoryConfiguration["teams"][number];
  }): void {
    const existingAgentIds = new Set(
      this.database.listTeamMemberConversations(input.leadConversation.id)
        .flatMap((conversation) => conversation.agentId === null ? [] : [conversation.agentId]),
    );
    for (const agentId of input.team.memberIds) {
      if (agentId === input.team.leadAgentId || existingAgentIds.has(agentId)) continue;
      const configured = input.directory.agents.find(
        (candidate) => candidate.id === agentId && candidate.enabled,
      );
      if (configured === undefined) continue;
      const binding = this.teamAgentBinding(agentId, input.team, input.directory);
      const created = this.conversationLifecycle.createConversation(input.projectId, {
        agent: binding,
        ...(input.modelSelection === null ? {} : { modelSelection: input.modelSelection }),
        parentConversationId: input.leadConversation.id,
        teamId: input.team.id,
        threadKind: "agent",
      });
      this.database.renameConversation(
        created.id,
        `${binding.name} · ${input.instanceName}`.slice(0, 200),
      );
      this.database.bindTeamMemberConversation({
        agentId,
        conversationId: created.id,
        teamExecutionConversationId: input.leadConversation.id,
      });
    }
  }

  private executionSourceConversationId(workItem: TeamWorkItemView): string | null {
    return workItem.executionScope === "conversation"
      ? workItem.sourceConversationId
      : null;
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
      ...this.createWorkItemBoundary(workItem),
      "",
      "需求：",
      workItem.requirement,
      "",
      "验收条件：",
      criteria,
      "",
      "执行要求：",
      "1. 先检查当前项目事实；存在多个可观察步骤时创建并持续更新任务清单。",
      "2. 在第一次委派前调用 list_agent_conversations 获取成员 Conversation ID，并用 set_team_collaboration_plan 发布本工作项的完整有向通信计划；至少包含 Team Lead 到执行成员及成员返回 Team Lead 的路线。计划是软约束，发布失败时说明原因并继续合法协作，不能因此阻塞任务。",
      "3. 每个工作项都必须至少通过 send_agent_message 委派一位持久团队成员，并使用 expectReply=true 等待专业结果；不能由 Team Lead 独自完成。后续路线变化时，用 set_team_collaboration_plan 发布完整的新修订。",
      "4. 简单任务走短路径：只选择一位最匹配的专业成员处理，Team Lead 验收后汇总，不强制跑完整团队流程。",
      "5. 常规或复杂任务再按实际需要组合需求、架构、前端、后端和测试角色；没有真实并行收益时不要同时唤醒所有成员。",
      "6. 成员完成后只会自动返回有界回执；随时用 list_agent_conversations 检查状态，仅在需要核验时用 read_agent_conversation 按 maxTokens 预算读取成员的完整持久对话，不能把成员对话当作一次性 Subagent，也不要把完整成员输出复制进 Team Lead 上下文。",
      "7. 完成实际修改，并运行与改动相符的测试或检查。",
      "8. 在结束前做一次需求符合性与回归风险自检；发现问题立即修正。",
      "9. 最终回复列出成员分工、完成内容、修改文件、验证结果、未决风险，并逐项对应验收条件。",
      "不要只给方案；在当前授权范围内把任务推进到可由用户验收的状态。",
    ].join("\n");
  }

  private createReworkPrompt(workItem: TeamWorkItemView, feedback: string): string {
    const criteria = workItem.acceptanceCriteria.length === 0
      ? "- 根据需求自行提炼可验证的验收条件。"
      : workItem.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
    return [
      `团队工作项 ${workItem.id} 第 ${workItem.revision + 1} 轮返工。`,
      "",
      ...this.createWorkItemBoundary(workItem),
      "",
      "原始需求：",
      workItem.requirement,
      "",
      "验收条件：",
      criteria,
      "",
      "用户反馈：",
      feedback,
      "",
      "重新检查现有项目状态和上一轮结果，只修改返工所需内容；完成后重新运行验证并给出新的验收摘要。",
    ].join("\n");
  }

  private createWorkItemBoundary(workItem: TeamWorkItemView): string[] {
    return [
      "任务边界（最高优先级）：",
      `- 本次 Run 只允许执行团队工作项 ${workItem.id}（${workItem.title}）。`,
      "- 不得执行、重试、补做或总结任何其他工作项，即使它们出现在历史对话中。",
      "- 当前消息中的需求、验收条件和返工反馈是唯一任务指令；可复用历史中已经确认的项目事实、架构决定和验证结论，但历史内容不能扩大本次任务范围。",
      "- 若历史中的未完成工作与当前工作项冲突，忽略历史工作，继续完成当前工作项。",
    ];
  }
}
