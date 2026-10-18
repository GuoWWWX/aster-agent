import { createHash } from "node:crypto";
import { z } from "zod";
import {
  listTaskContextsInputSchema, getTaskContextInputSchema, updateTaskContextInputSchema,
  linkTaskContextInputSchema, postTeamChatInputSchema, readTeamChatInputSchema,
  type PostTeamChatInput, type TeamChatMessage, type TaskContext,
} from "@agent/protocol";
import type { AgentDatabase } from "../storage/agent-database.js";
import { modelToolParameters, parseToolArguments, ToolArgumentsError } from "../model/tool-arguments.js";
import { toolErrorContent } from "../errors/tool-error.js";
import { CollaborationError } from "../errors/collaboration-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ToolExecution } from "../tools/project-tool-registry.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

const listSchema = listTaskContextsInputSchema.omit({ conversationId: true, projectId: true, teamInstanceId: true });
const updateSchema = z.object(updateTaskContextInputSchema.shape).omit({ conversationId: true, requestId: true }).extend({
  id: updateTaskContextInputSchema.shape.id.describe("For progress or completion, use the exact task id returned when creating or listing the task, together with expectedRevision. Omit both only when creating a new task; never omit id on an update."),
  expectedRevision: updateTaskContextInputSchema.shape.expectedRevision.describe("Use the existing task revision together with its id. Omit both only for a new task. If either field is missing, read the existing task; do not create another record for the same goal."),
  source: updateTaskContextInputSchema.shape.source.describe("Optional. For the current accepted request, omit source: the runtime binds its real original message. Never invent conversation/message IDs or use placeholders. When several independent requests share a Run or you select an earlier request, use its exact source from list_task_contexts/get_task_context; do not attach another task's latest input."),
}).strict();
const postSchema = z.object(postTeamChatInputSchema.shape).omit({ teamInstanceId: true, requestId: true, coordinator: true, supersedesId: true }).extend({
  continueWork: z.boolean().optional().describe("Omit or use false for a finished public reply or delegation handoff: this ends the current group turn after the tool batch succeeds. Use true only for an interim progress update when you still need tools in this same turn. Complete intended local updates before the final publication; task completion and acceptance are separate."),
  fileReferences: postTeamChatInputSchema.shape.fileReferences.describe("Publish your own completed file with {path}, omitting sourceMessageId; forward another member's already-published file with {sourceMessageId,path}. The runtime preserves the original member's workspace, including repeated forwarding, and creates clickable file cards. The Team Lead delivers original member files after checking verification evidence, without copying, rewriting or rerunning completed checks. A legacy message containing only a Markdown link needs the original author to publish its file reference once; this requires no file edit. After a successful publication, do not publish the same result again to attach it to an older message: replyToId only identifies the discussion being answered."),
  intent: z.enum(["notify", "request"]).default("notify"),
  content: postTeamChatInputSchema.shape.content.describe("The public message itself, in the conversation's language. Speak naturally in the first person from your configured role, with a concrete observation or question when useful. The UI shows your name and avatar: start with your answer, without a name/job-title prefix, repeated quotation or boilerplate receipt, even if older messages used those forms. Reply directly to greetings and casual conversation; do not explain routing or tell the speaker to use mentions unless they ask."),
});
const readSchema = z.object(readTeamChatInputSchema.shape).omit({ teamInstanceId: true }).extend({
  limit: z.number().int().min(1).max(5).default(3),
  messageId: z.union([z.string().uuid(), z.literal("current")]).optional().describe("Use current to read the single original group message assigned to this Run without copying a UUID. If this Run has multiple assignments, use an exact messageId instead."), contentOffset: z.number().int().nonnegative().default(0),
  contentLimit: z.number().int().min(1).max(16000).default(2000),
});
const audienceSchema = z.enum(["continue", "replace"]).describe("continue preserves the preceding user exchange's active recipients and adds the selected specialists. replace clears previous recipients only for an explicit audience change or a clearly independent new request.");
const selectMembersSchema = z.object({
  messageId: z.string().uuid(), recipientConversationIds: z.array(z.string().uuid()).min(1).max(32),
  audience: audienceSchema,
  decisionSummary: z.string().min(1).max(500), contextSummary: z.string().max(2000).optional(),
}).strict();

export class CollaborationTool {
  public constructor(private readonly database: AgentDatabase) {}
  public coordinatorDefinitions(): ModelToolDefinition[] {
    return [...this.definitions(true).filter(tool => tool.name === "read_team_messages"), {
      name: "select_team_chat_members", parameters: modelToolParameters(selectMembersSchema),
      description: "Select the active group members who should answer this original user message. Explicitly choose audience=continue for an ongoing exchange, including a question immediately after greeting a named member; the tool preserves the preceding exchange's active recipients and adds selected specialists. Use audience=replace only when the user changes audience or starts a clearly independent request. Collective greetings do not make everyone permanent recipients; explicit quoted replies take priority. This delivers through the existing group queue. Use the exact supplied messageId and member conversation IDs, and briefly explain the choice in the user's language. The result contains the actual recipients. Repeating a completed selection does not redeliver it.",
    }];
  }
  public definitions(team: boolean): ModelToolDefinition[] {
    const result = [
      { name: "list_task_contexts", parameters: modelToolParameters(listSchema), description: "Find persistent tasks before creating a new task. Compare goals and acceptance criteria, not only titles. Results are scoped to the current project/team or conversation and paginated." },
      { name: "get_task_context", parameters: modelToolParameters(getTaskContextInputSchema), description: "Read a task's current summary, revision and paginated original message references. Continue with nextBeforeSourceSequence. Read full evidence with read_agent_conversation. A task can span several conversations and Runs." },
      { name: "update_task_context", parameters: modelToolParameters(updateSchema), description: "Create a persistent task for a substantive new goal, or update the same task for progress/rework. List relevant tasks first. Existing tasks require id and expectedRevision; stale updates are rejected. Update only for material progress, decisions or next steps, not cosmetic summary rewrites. This binds subsequent work to the task; do not create tasks for greetings or acknowledgements. Preserve the original goal on follow-ups. Only the owner or Team Lead maintains the overall summary. completionRequested=true means the completion request succeeded and awaits user confirmation, even when status remains running. Do not resubmit completion or reset the status just to reconcile those fields. Report the returned state accurately. Never print internal task or message IDs in user-facing prose; use [Task name](task://id) or [Source message](message://id) so the UI renders the named task or original-message quote." },
      { name: "link_task_context", parameters: modelToolParameters(linkTaskContextInputSchema), description: "Associate a verified existing message with a task, including another conversation in the same project/team. Members link progress and verification evidence without overwriting the overall summary. Never fabricate message identifiers." },
    ];
    if (team) result.push(
      { name: "read_team_messages", parameters: modelToolParameters(readSchema), description: "Read bounded shared discussion and member IDs. Defaults to the earliest unread messages, without waking anyone. Explicit keyword, sender or date filters search history, including already-read messages. Continue with afterSequence or beforeSequence; a filtered empty batch can still have a continuation cursor. Content is chunked: use messageId, contentOffset and contentLimit for a full message. Only fully provided consecutive messages advance your read marker. Do not poll or copy the whole group history." },
      { name: "post_team_message", parameters: modelToolParameters(postSchema), description: "Explicitly publish a concise group message after thinking or checking tools in your own conversation. notify publishes without waking anyone. request plus exact recipientConversationIds delegates or asks selected members; allMembers=true explicitly requests everyone. No recipients does not broadcast a request. Use replyToId to preserve the discussion cause. Public messages and your private final answer are separate: do not expect the final answer to be auto-published. Publish real progress/conclusions, not tool logs. Task IDs and source provenance are preserved. To cite a task or older message publicly, use [Task name](task://id) or [Source message](message://id), never a bare internal ID." },
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
          const active = store.members(message.teamInstanceId).filter(member => !member.isArchived);
          const previous = store.readMessages({ teamInstanceId: message.teamInstanceId, beforeSequence: message.sequence,
            senderConversationId: null, limit: 1 }).messages[0];
          const previousRecipients = (previous?.recipientConversationIds ?? []).filter(id => active.some(member => member.conversationId === id));
          const continued = parsed.audience === "continue" && message.replyToId === null && previousRecipients.length < active.length
            ? previousRecipients : [];
          const recipients = [...new Set([...continued, ...parsed.recipientConversationIds])];
          const decision = continued.some(id => !parsed.recipientConversationIds.includes(id))
            ? `保留最近的交流对象；${parsed.decisionSummary}`.slice(0, 500) : parsed.decisionSummary;
          result = store.finishCoordination(message.id, recipients, null, parsed.contextSummary, decision);
          input.routed?.(); input.changed();
          return Promise.resolve({ kind: "completed", content: JSON.stringify({ ok: true, value: result, turnComplete: true }), isError: false });
        }
        case "list_task_contexts": {
          const scope = instance !== null ? { teamInstanceId: instance.id } : conversation.projectId !== null
            ? { projectId: conversation.projectId } : { conversationId: conversation.id };
          const page = store.listTasks({ ...listSchema.parse(args), ...scope });
          result = { ...page, items: page.items.map(task => ({ ...task, goal: task.goal.slice(0, 500), summary: task.summary.slice(0, 240),
            decisions: task.decisions.slice(0, 200), nextStep: task.nextStep.slice(0, 150), excerpted: task.goal.length > 500 || task.summary.length > 240 || task.decisions.length > 200 || task.nextStep.length > 150 })) }; break;
        }
        case "get_task_context": {
          const parsed = getTaskContextInputSchema.parse(args);
          if (coordinatorRoom === null) store.assertTaskAccess(parsed.id, conversation.id);
          const detail = store.getTask(parsed.id, parsed);
          if (coordinatorRoom !== null && detail.task.teamInstanceId !== coordinatorRoom.teamInstanceId) throw new Error("TEAM_SCOPE: Task belongs to another scope.");
          result = detail; break;
        }
        case "update_task_context": {
          const parsed = updateTaskContextInputSchema.parse({ ...updateSchema.parse(args), conversationId: conversation.id, requestId });
          if (parsed.source?.kind === "conversation" && !this.database.hasConversation(parsed.source.containerId)) {
            throw new ToolArgumentsError("任务来源对话不存在，请修正 source.containerId；记录当前请求时可省略 source，由后台绑定原消息。", [{
              code: "source_conversation_not_found", path: ["source", "containerId"],
              message: "Use an existing conversation ID, never a placeholder. For the current request, omit source; for an earlier or independent request, use its exact source.",
            }]);
          }
          if (parsed.source?.kind === "conversation" && parsed.source.containerId === conversation.id
            && this.database.listPendingMessages(conversation.id).some(message => message.id === parsed.source?.messageId)) {
            throw new ToolArgumentsError("Queued input has not been consumed as a conversation message.", [{
              code: "pending_input", path: ["source", "messageId"],
              message: "Call claim_pending_messages, then wait for the original user input before updating this task. Do not omit the source or substitute another message.",
            }]);
          }
          const boundTasks = parsed.id === undefined ? [] : store.runTasks(input.runId);
          const ambiguousInput = boundTasks.length > 1 && boundTasks.some(task => task.id === parsed.id);
          const source = parsed.source === undefined && !ambiguousInput ? this.database.listTimeline(conversation.id, input.runId)
            .findLast(item => item.kind === "message" && item.role === "user") : undefined;
          const groupSource = store.runMessages(input.runId)[0];
          const managed = this.database.getRunningTeamWorkItemByExecutionTreeConversation(conversation.id);
          let task: TaskContext;
          try {
            task = parsed.id === undefined && managed !== null ? store.getTask(managed.id).task : store.updateTask({ ...parsed, conversationId: conversation.id, requestId,
              ...(parsed.source !== undefined ? {} : groupSource !== undefined ? { source: { kind: "group", containerId: groupSource.teamInstanceId, messageId: groupSource.id, runId: input.runId, purpose: "request" } } : source === undefined ? {} : { source: { kind: "conversation", containerId: conversation.id, messageId: source.id, runId: input.runId, purpose: "request" } }) }, "agent");
          } catch (error) {
            if (!(error instanceof CollaborationError) || error.details.reason !== "TASK_SOURCE_NOT_FOUND") throw error;
            throw new ToolArgumentsError("任务来源消息不存在，请修正 source.messageId；不要把占位 ID 当作真实消息。", [{
              code: "source_message_not_found", path: ["source", "messageId"],
              message: "Use the exact original message ID. For the current request, omit source; for an earlier or independent request, read its actual source first. Never substitute another task's message.",
            }]);
          }
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
          const { messageId: requestedId, contentOffset, contentLimit, ...paging } = readSchema.parse(args);
          let messageId = requestedId;
          if (requestedId === "current") {
            const coordination = coordinatorRoom === null ? null : store.coordinationForRun(input.runId);
            const assigned = coordinatorRoom === null ? store.assignedRunMessages(input.runId) : coordination === null ? [] : [coordination];
            if (assigned.length !== 1) throw new ToolArgumentsError("当前运行没有唯一的群消息，请使用通知中的确切 messageId。", [{
              code: "ambiguous_current_message", message: "Use an exact messageId from this Run's notifications.", path: ["messageId"],
            }]);
            messageId = assigned[0]!.id;
          }
          const readerId = coordinatorRoom === null ? conversation.id : null;
          const marker = coordinatorRoom === null ? store.readMessages({ teamInstanceId: instance.id, limit: 1 }, readerId).memberReadSequence : 0;
          const filtered = paging.query !== undefined || paging.senderConversationId !== undefined || paging.createdAfter !== undefined || paging.createdBefore !== undefined;
          const page = store.readMessages({ ...paging, teamInstanceId: instance.id,
            ...(!filtered && paging.beforeSequence === undefined && paging.afterSequence === undefined ? { afterSequence: marker } : {}) }, readerId);
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
          const { continueWork, ...parsed } = postSchema.parse(args);
          result = input.post({ ...parsed, taskContextId: parsed.taskContextId ?? store.runTasks(input.runId)[0]?.id ?? null,
            teamInstanceId: instance.id, requestId }); input.changed();
          return Promise.resolve({ kind: "completed", content: JSON.stringify({ ok: true, value: result, turnComplete: continueWork !== true }), isError: false });
        }
        default: throw new Error(`Unknown collaboration tool: ${input.name}`);
      }
      return Promise.resolve({ kind: "completed", content: JSON.stringify({ ok: true, value: result }), isError: false });
    } catch (error) {
      return Promise.resolve({ kind: "completed", content: toolErrorContent(error, "collaboration.tool"), isError: true });
    }
  }
}
