import { createHash } from "node:crypto";
import { z } from "zod";
import {
  listTaskContextsInputSchema, getTaskContextInputSchema, updateTaskContextInputSchema,
  linkTaskContextInputSchema, postTeamChatInputSchema, readTeamChatInputSchema,
  type PostTeamChatInput, type TeamChatMessage,
} from "@agent/protocol";
import type { AgentDatabase } from "../storage/agent-database.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ToolExecution } from "../tools/project-tool-registry.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

const listSchema = listTaskContextsInputSchema.omit({ conversationId: true, projectId: true, teamInstanceId: true });
const updateSchema = z.object(updateTaskContextInputSchema.shape).omit({ conversationId: true, requestId: true }).strict();
const postSchema = z.object(postTeamChatInputSchema.shape).omit({ teamInstanceId: true, requestId: true, coordinator: true, supersedesId: true }).extend({
  intent: z.enum(["notify", "request"]).default("notify"),
  content: postTeamChatInputSchema.shape.content.describe("The public message itself, in the conversation's language. Speak naturally in the first person from your configured role, with a concrete observation or question when useful. The UI shows your name and avatar: start with your answer, without a name/job-title prefix, repeated quotation or boilerplate receipt, even if older messages used those forms. Reply directly to greetings and casual conversation; do not explain routing or tell the speaker to use mentions unless they ask."),
});
const readSchema = readTeamChatInputSchema.omit({ teamInstanceId: true }).extend({
  limit: z.number().int().min(1).max(5).default(3),
  messageId: z.string().uuid().optional(), contentOffset: z.number().int().nonnegative().default(0),
  contentLimit: z.number().int().min(1).max(16000).default(2000),
});
const selectMembersSchema = z.object({
  messageId: z.string().uuid(), recipientConversationIds: z.array(z.string().uuid()).min(1).max(32),
  decisionSummary: z.string().min(1).max(500), contextSummary: z.string().max(2000).optional(),
}).strict();

export class CollaborationTool {
  public constructor(private readonly database: AgentDatabase) {}
  public coordinatorDefinitions(): ModelToolDefinition[] {
    return [...this.definitions(true).filter(tool => tool.name === "read_team_messages"), {
      name: "select_team_chat_members", parameters: modelToolParameters(selectMembersSchema),
      description: "Select the active group members who should answer this original user message. This delivers the original request and attributed public context through the existing group queue. Use the exact supplied messageId and member conversation IDs. Explain the choice briefly in the user's language. Repeating an already completed selection does not redeliver it.",
    }];
  }
  public definitions(team: boolean): ModelToolDefinition[] {
    const result = [
      { name: "list_task_contexts", parameters: modelToolParameters(listSchema), description: "Find persistent tasks before creating a new task. Compare goals and acceptance criteria, not only titles. Results are scoped to the current project/team or conversation and paginated." },
      { name: "get_task_context", parameters: modelToolParameters(getTaskContextInputSchema), description: "Read a task's current summary, revision and paginated original message references. Continue with nextBeforeSourceSequence. Read full evidence with read_agent_conversation. A task can span several conversations and Runs." },
      { name: "update_task_context", parameters: modelToolParameters(updateSchema), description: "Create a persistent task for a substantive new goal, or update the same task for progress/rework. List relevant tasks first. Existing tasks require id and expectedRevision; stale updates are rejected. Keep effective decisions, constraints and nextStep concise. This binds subsequent work to the task; do not create tasks for greetings or acknowledgements. Preserve the original goal on follow-ups. Only the owner or Team Lead maintains the overall summary. Completed requests without user-granted permission are recorded as completionRequested for user confirmation; report the returned status accurately. Never print internal task or message IDs in user-facing prose; use [任务 名称](task://id) or [引用消息](message://id) so the UI renders the named task or original-message quote." },
      { name: "link_task_context", parameters: modelToolParameters(linkTaskContextInputSchema), description: "Associate a verified existing message with a task, including another conversation in the same project/team. Members link progress and verification evidence without overwriting the overall summary. Never fabricate message identifiers." },
    ];
    if (team) result.push(
      { name: "read_team_messages", parameters: modelToolParameters(readSchema), description: "Read bounded shared discussion and member IDs. Defaults to the earliest unread messages, without waking anyone. Continue with afterSequence or beforeSequence. Content is chunked: use messageId, contentOffset and contentLimit for a full message. Only fully provided consecutive messages advance your read marker. Do not poll or copy the whole group history." },
      { name: "post_team_message", parameters: modelToolParameters(postSchema), description: "Explicitly publish a concise group message after thinking or checking tools in your own conversation. notify publishes without waking anyone. request plus exact recipientConversationIds delegates or asks selected members; allMembers=true explicitly requests everyone. No recipients does not broadcast a request. Use replyToId to preserve the discussion cause. Public messages and your private final answer are separate: do not expect the final answer to be auto-published. Publish real progress/conclusions, not tool logs. Task IDs and source provenance are preserved. To cite a task or older message publicly, use [任务 名称](task://id) or [引用消息](message://id), never a bare internal ID." },
    );
    return result;
  }
  public policy(name: string): ToolExecutionPolicy {
    return name.startsWith("list_") || name.startsWith("get_") || name.startsWith("read_") ? { kind: "parallel", group: "read" } : { kind: "serial" };
  }
  public execute(input: { name: string; arguments: string; conversationId: string; runId: string; toolCallId: string;
    post: (message: PostTeamChatInput) => TeamChatMessage; changed: () => void; routed?: () => void }): Promise<ToolExecution> {
    try {
      const args = parseToolArguments(input.arguments);
      const requestId = createHash("sha256").update(`${input.runId}:${input.toolCallId}`).digest("hex");
      const store = this.database.collaboration; const conversation = this.database.getConversation(input.conversationId);
      const coordinatorRoom = store.coordinatorRoom(conversation.id);
      const instance = coordinatorRoom === null ? this.database.getTeamInstanceForConversation(conversation.id)
        : this.database.getTeamInstance(coordinatorRoom.teamInstanceId);
      if (input.name !== "read_team_messages" && input.name !== "post_team_message") {
        store.syncWorkItems(this.database.listTeamWorkItems({ ...(instance === null ? {} : { teamId: instance.teamId }) }));
      }
      let result: unknown;
      switch (input.name) {
        case "select_team_chat_members": {
          const parsed = selectMembersSchema.parse(args);
          const message = store.message(parsed.messageId);
          if (coordinatorRoom?.teamInstanceId !== message.teamInstanceId || message.coordinator?.conversationId !== conversation.id
            || message.coordinator.runId !== input.runId) throw new Error("TEAM_SCOPE: This Run cannot route another request.");
          if (message.coordinator.status === "paused" || message.coordinator.status === "cancelled") throw new Error("群聊协调已暂停或取消。");
          result = store.finishCoordination(message.id, parsed.recipientConversationIds, null, parsed.contextSummary, parsed.decisionSummary);
          input.routed?.(); input.changed(); break;
        }
        case "list_task_contexts": {
          const scope = instance !== null ? { teamInstanceId: instance.id } : conversation.projectId !== null
            ? { projectId: conversation.projectId } : { conversationId: conversation.id };
          const page = store.listTasks({ ...listSchema.parse(args), ...scope });
          result = { ...page, items: page.items.map(task => ({ ...task, goal: task.goal.slice(0, 500), summary: task.summary.slice(0, 240),
            decisions: task.decisions.slice(0, 200), nextStep: task.nextStep.slice(0, 150), excerpted: task.goal.length > 500 || task.summary.length > 240 || task.decisions.length > 200 || task.nextStep.length > 150 })) }; break;
        }
        case "get_task_context": {
          const parsed = getTaskContextInputSchema.parse(args); store.assertTaskAccess(parsed.id, conversation.id);
          result = store.getTask(parsed.id, parsed); break;
        }
        case "update_task_context": {
          const parsed = updateSchema.parse(args);
          const source = this.database.listTimeline(conversation.id).findLast(item => item.kind === "message" && item.role === "user" && item.runId === input.runId);
          const groupSource = store.runMessages(input.runId)[0];
          const managed = this.database.getRunningTeamWorkItemByExecutionTreeConversation(conversation.id);
          const task = parsed.id === undefined && managed !== null ? store.getTask(managed.id).task : store.updateTask({ ...parsed, conversationId: conversation.id, requestId,
            ...(parsed.source !== undefined ? {} : groupSource !== undefined ? { source: { kind: "group", containerId: groupSource.teamInstanceId, messageId: groupSource.id, runId: input.runId, purpose: "request" } } : source === undefined ? {} : { source: { kind: "conversation", containerId: conversation.id, messageId: source.id, runId: input.runId, purpose: "request" } }) }, "agent");
          result = task;
          store.bindTask(input.runId, task.id, conversation.id);
          for (const message of store.runMessages(input.runId)) store.linkTask({ id: task.id, source: {
            kind: "group", containerId: message.teamInstanceId, messageId: message.id, runId: input.runId, purpose: "request",
          } });
          if (source !== undefined) store.linkTask({ id: task.id, source: { kind: "conversation", containerId: conversation.id, messageId: source.id, runId: input.runId, purpose: "request" } });
          input.changed(); break;
        }
        case "link_task_context": {
          const parsed = linkTaskContextInputSchema.parse(args); store.assertTaskAccess(parsed.id, conversation.id);
          store.linkTask(parsed); store.bindTask(input.runId, parsed.id, conversation.id); result = { linked: !parsed.remove }; input.changed(); break;
        }
        case "read_team_messages": {
          if (instance === null) throw new Error("TEAM_MEMBER: Conversation is not in a team.");
          const { messageId, contentOffset, contentLimit, ...paging } = readSchema.parse(args);
          const readerId = coordinatorRoom === null ? conversation.id : null;
          const marker = coordinatorRoom === null ? store.readMessages({ teamInstanceId: instance.id, limit: 1 }, readerId).memberReadSequence : 0;
          const page = store.readMessages({ ...paging, teamInstanceId: instance.id,
            ...(paging.beforeSequence === undefined && paging.afterSequence === undefined ? { afterSequence: marker } : {}) }, readerId);
          const selected = messageId === undefined ? page.messages : [store.message(messageId)];
          if (selected.some(message => message.teamInstanceId !== instance.id)) throw new Error("TEAM_SCOPE: Message belongs to another room.");
          const messages = selected.map(message => ({ ...message, content: message.content.slice(contentOffset, contentOffset + (messageId === undefined ? Math.min(contentLimit, 2000) : contentLimit)),
            contentOffset, nextContentOffset: contentOffset + (messageId === undefined ? Math.min(contentLimit, 2000) : contentLimit) < message.content.length ? contentOffset + (messageId === undefined ? Math.min(contentLimit, 2000) : contentLimit) : null }));
          let through = marker;
          for (const message of messages) {
            if (message.sequence !== through + 1 || message.contentOffset !== 0 || message.nextContentOffset !== null) break;
            through = message.sequence;
          }
          if (through > marker && coordinatorRoom === null) store.markRead({ teamInstanceId: instance.id, throughSequence: through }, conversation.id);
          result = { ...page, messages: messages.map(message => ({ ...message,
            coordinator: message.coordinator == null ? message.coordinator : { ...message.coordinator, steps: undefined },
            perspective: message.senderConversationId === null ? "user" : message.senderConversationId === conversation.id ? "self" : "member" })),
            memberReadSequence: through, nextAfterSequence: messages.at(-1)?.sequence ?? marker, members: store.members(instance.id) }; break;
        }
        case "post_team_message": {
          if (instance === null) throw new Error("TEAM_MEMBER: Conversation is not in a team.");
          const parsed = postSchema.parse(args);
          result = input.post({ ...parsed, taskContextId: parsed.taskContextId ?? store.runTasks(input.runId)[0]?.id ?? null,
            teamInstanceId: instance.id, requestId }); input.changed(); break;
        }
        default: throw new Error(`Unknown collaboration tool: ${input.name}`);
      }
      return Promise.resolve({ kind: "completed", content: JSON.stringify({ ok: true, value: result }), isError: false });
    } catch (error) {
      return Promise.resolve({ kind: "completed", content: toolErrorContent(error, "collaboration.tool"), isError: true });
    }
  }
}
