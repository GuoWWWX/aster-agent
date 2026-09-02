import { z } from "zod";
import type {
  AgentDirectoryConfiguration,
  ConversationModelSelection,
  ConversationPermissionMode,
  ConversationRunEvent,
  SubmitTeamWorkItemInput,
  TeamWorkItemView,
} from "@agent/protocol";

import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { AgentDatabase } from "../storage/agent-database.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

const SUBMIT_TEAM_WORK_ITEM_TOOL_NAME = "submit_team_work_item";
const GET_TEAM_WORK_ITEM_STATUS_TOOL_NAME = "get_team_work_item_status";
const MAX_STATUS_ITEMS = 20;
const MAX_STATUS_SUMMARY_LENGTH = 2_000;
const MAX_STATUS_REASON_LENGTH = 1_000;

const submitArgumentsSchema = z.object({
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20).default([])
    .describe("Optional concrete acceptance criteria for this work item."),
  priority: z.enum(["high", "normal", "low"]).default("normal")
    .describe("Queue priority. Use normal unless the user explicitly marks this work urgent or low priority."),
  requirement: z.string().trim().min(1).max(50_000)
    .describe("The complete user requirement to hand off to the selected Team."),
  teamInstanceId: z.string().uuid()
    .describe("Exact Team instance ID from the current visible Team instance catalog."),
  title: z.string().trim().min(1).max(300)
    .describe("Short, specific WorkItem title shown in the Team board."),
}).strict();

const getStatusArgumentsSchema = z.object({
  workItemId: z.string().uuid().optional()
    .describe("A WorkItem ID returned by submit_team_work_item. Omit it to list recent WorkItems submitted by this conversation."),
}).strict();

type RunEventEmitter = (event: ConversationRunEvent) => void;

type TeamWorkItemDispatcher = {
  submit(input: SubmitTeamWorkItemInput, emit: RunEventEmitter): TeamWorkItemView;
};

type TeamWorkItemToolExecution = {
  content: string;
  isError: boolean;
  kind: "completed";
};

export class TeamWorkItemTool {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly getDirectory: () => AgentDirectoryConfiguration | null,
    private readonly getDispatcher: () => TeamWorkItemDispatcher | null,
  ) {}

  public getDefinitions(): readonly ModelToolDefinition[] {
    return [
      {
        description: "Create a durable Team WorkItem from the current project conversation. Use this only when the user explicitly @mentions a visible Team instance or clearly asks to hand this task to that Team. Choose the exact teamInstanceId from the scoped catalog. The selected instance scope is fixed: global and project instances are reused, while a conversation instance is isolated to its owning conversation. Never create or derive another Team implicitly. The WorkItem is queued durably and an enabled Team automatically dispatches it when capacity is available.",
        name: SUBMIT_TEAM_WORK_ITEM_TOOL_NAME,
        parameters: modelToolParameters(submitArgumentsSchema),
      },
      {
        description: "Read bounded progress for Team WorkItems previously submitted by this conversation. Omit workItemId to recover recent IDs; provide it for compact task, participant, and result status. Call only when the user asks for progress or the result is needed, and do not poll continuously. The renderer canvas is not included.",
        name: GET_TEAM_WORK_ITEM_STATUS_TOOL_NAME,
        parameters: modelToolParameters(getStatusArgumentsSchema),
      },
    ];
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    switch (toolName) {
      case SUBMIT_TEAM_WORK_ITEM_TOOL_NAME:
        return { kind: "serial" };
      case GET_TEAM_WORK_ITEM_STATUS_TOOL_NAME:
        return { group: "read", kind: "parallel" };
      default:
        throw new Error(`Unknown Team WorkItem tool: ${toolName}`);
    }
  }

  public isAvailable(conversationId: string | undefined, projectId: string | undefined): boolean {
    return conversationId !== undefined
      && projectId !== undefined
      && this.getDispatcher() !== null
      && this.canSubmitFromConversation(conversationId, projectId)
      && this.visibleInstances(conversationId, projectId).length > 0;
  }

  public getCatalogPrompt(conversationId: string): string | null {
    const conversation = this.database.getConversation(conversationId);
    if (!this.canSubmitFromConversation(conversation.id, conversation.projectId ?? undefined)) return null;
    const instances = this.visibleInstances(conversation.id, conversation.projectId!);
    if (instances.length === 0) return null;
    const teams = new Map((this.getDirectory()?.teams ?? []).map((team) => [team.id, team]));
    return [
      "Team handoff is available in this main project conversation. Only call submit_team_work_item when the user explicitly mentions a Team with @ or explicitly asks to send work to a Team; do not silently hand off ordinary requests.",
      "Choose by the exact visible instance name and teamInstanceId below. Global instances are visible in every project; project instances are visible only in this project; conversation instances are visible only in this conversation.",
      "The selected instance already determines scope. Never derive or create a different Team instance during handoff.",
      "Visible Team instances:",
      ...instances.map((instance) => {
        const team = teams.get(instance.teamId);
        return `- @${instance.name} (teamInstanceId: ${instance.id}; scope: ${instance.scope}; template: ${team?.name ?? instance.teamId}; ${team?.enabled === false ? "paused: accept and queue only" : "automatic dispatch enabled"})`;
      }),
      "After a successful handoff, tell the user that the request was queued and that they can inspect the Team board or the member side tabs while the main conversation remains available.",
    ].join("\n");
  }

  public execute(input: {
    arguments: string;
    conversationId: string;
    emit: RunEventEmitter;
    modelSelection: ConversationModelSelection | undefined;
    permissionMode: ConversationPermissionMode;
    signal: AbortSignal;
    toolName: string;
  }): Promise<TeamWorkItemToolExecution> {
    try {
      input.signal.throwIfAborted();
      if (input.toolName === GET_TEAM_WORK_ITEM_STATUS_TOOL_NAME) {
        return Promise.resolve(this.getStatus(input.arguments, input.conversationId));
      }
      if (input.toolName !== SUBMIT_TEAM_WORK_ITEM_TOOL_NAME) {
        throw new Error(`Unknown Team WorkItem tool: ${input.toolName}`);
      }
      const dispatcher = this.getDispatcher();
      if (dispatcher === null) throw new Error("Team dispatch is unavailable.");
      const conversation = this.database.getConversation(input.conversationId);
      if (!this.canSubmitFromConversation(conversation.id, conversation.projectId ?? undefined)) {
        throw new Error("Only a main project conversation can submit a Team WorkItem.");
      }
      const argumentsValue = submitArgumentsSchema.parse(parseToolArguments(input.arguments));
      const instance = this.visibleInstances(conversation.id, conversation.projectId!)
        .find((candidate) => candidate.id === argumentsValue.teamInstanceId);
      if (instance === undefined) throw new Error("The selected Team instance is not visible here.");
      const team = this.getDirectory()?.teams.find((candidate) => candidate.id === instance.teamId);
      if (team === undefined) throw new Error("The selected Team template is not available.");
      const executionScope = instance.scope === "conversation" ? "conversation" : "project";
      const workItem = dispatcher.submit({
        acceptanceCriteria: argumentsValue.acceptanceCriteria,
        executionScope,
        ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
        permissionMode: input.permissionMode,
        priority: argumentsValue.priority,
        projectId: conversation.projectId!,
        requirement: argumentsValue.requirement,
        sourceConversationId: conversation.id,
        teamId: instance.teamId,
        teamInstanceId: instance.id,
        title: argumentsValue.title,
      }, input.emit);
      return Promise.resolve({
        content: JSON.stringify({
          ok: true,
          value: {
            executionConversationId: workItem.executionConversationId,
            id: workItem.id,
            status: workItem.status,
            teamId: workItem.teamId,
            teamInstanceId: workItem.teamInstanceId,
            title: workItem.title,
          },
        }),
        isError: false,
        kind: "completed",
      });
    } catch (error) {
      if (input.signal.aborted) throw error;
      return Promise.resolve({
        content: toolErrorContent(error, `tool:${input.toolName}`),
        isError: true,
        kind: "completed",
      });
    }
  }

  private getStatus(argumentsJson: string, conversationId: string): TeamWorkItemToolExecution {
    const conversation = this.database.getConversation(conversationId);
    if (!this.canSubmitFromConversation(conversation.id, conversation.projectId ?? undefined)) {
      throw new Error("Only a main project conversation can inspect its submitted Team WorkItems.");
    }
    const argumentsValue = getStatusArgumentsSchema.parse(parseToolArguments(argumentsJson));
    if (argumentsValue.workItemId === undefined) {
      const items = this.database.listTeamWorkItems({ projectId: conversation.projectId! })
        .filter((workItem) => workItem.sourceConversationId === conversation.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_STATUS_ITEMS)
        .map((workItem) => ({
          id: workItem.id,
          priority: workItem.priority,
          status: workItem.status,
          title: workItem.title,
          updatedAt: workItem.updatedAt,
        }));
      return {
        content: JSON.stringify({ ok: true, value: { items } }),
        isError: false,
        kind: "completed",
      };
    }

    const workItem = this.database.getTeamWorkItem(argumentsValue.workItemId);
    if (workItem.sourceConversationId !== conversation.id) {
      throw new Error("This Team WorkItem was not submitted by the current conversation.");
    }
    const projection = this.database.getTeamCollaborationProjection(workItem.id);
    const taskCounts = {
      blocked: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
    };
    for (const task of workItem.tasks) taskCounts[task.status] += 1;
    const participantCounts = {
      blocked: 0,
      completed: 0,
      failed: 0,
      idle: 0,
      queued: 0,
      running: 0,
    };
    for (const participant of projection.nodes) participantCounts[participant.runStatus] += 1;
    return {
      content: JSON.stringify({
        ok: true,
        value: {
          blockedReason: boundedStatusText(workItem.blockedReason, MAX_STATUS_REASON_LENGTH),
          collaboration: {
            lastActivityAt: projection.summary.lastActivityAt,
            messageCount: projection.summary.messageCount,
            participantCounts,
            participants: projection.nodes.slice(0, MAX_STATUS_ITEMS).map((participant) => ({
              latestOutput: participant.latestOutput,
              name: participant.name,
              role: participant.role,
              runStatus: participant.runStatus,
            })),
          },
          completedAt: workItem.completedAt,
          id: workItem.id,
          priority: workItem.priority,
          resultSummary: boundedStatusText(workItem.resultSummary, MAX_STATUS_SUMMARY_LENGTH),
          revision: workItem.revision,
          status: workItem.status,
          tasks: {
            counts: taskCounts,
            items: workItem.tasks.map((task) => ({
              reason: boundedStatusText(task.reason, MAX_STATUS_REASON_LENGTH),
              status: task.status,
              title: task.title,
            })),
          },
          title: workItem.title,
          updatedAt: workItem.updatedAt,
        },
      }),
      isError: false,
      kind: "completed",
    };
  }

  private canSubmitFromConversation(conversationId: string, projectId: string | undefined): boolean {
    if (projectId === undefined) return false;
    const conversation = this.database.getConversation(conversationId);
    return conversation.projectId === projectId
      && conversation.parentConversationId === null
      && conversation.threadKind === "agent"
      && conversation.teamWorkItemId === null
      && !conversation.isArchived;
  }

  private visibleInstances(conversationId: string, projectId: string) {
    return this.database.listTeamInstances({ includeArchived: false }).filter((instance) =>
      instance.scope === "global"
      || (instance.scope === "project" && instance.projectId === projectId)
      || (
        instance.scope === "conversation"
        && instance.projectId === projectId
        && instance.sourceConversationId === conversationId
      )
    );
  }
}

function boundedStatusText(value: string | null, limit: number): string | null {
  if (value === null || value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

export type { TeamWorkItemDispatcher };
