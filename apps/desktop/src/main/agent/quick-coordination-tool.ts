import { z } from "zod";
import type { ConversationPendingMessage } from "@agent/protocol";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import type { AgentDatabase } from "../storage/agent-database.js";

const listSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const claimSchema = z.object({
  pendingMessageIds: z.array(z.string().uuid()).min(1).max(5)
    .refine(ids => new Set(ids).size === ids.length, "Request IDs must be unique.")
    .describe("Select one request, or up to five related requests to arrange together. Unselected requests stay pending."),
}).strict();

/** Preview is read-only. A claim schedules consumption at the next safe model boundary. */
export class QuickCoordinationTool {
  public constructor(private readonly database: AgentDatabase) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [
      { name: "list_pending_messages", parameters: modelToolParameters(listSchema),
        description: "Preview the durable request queue without consuming it. This is selection data, not accepted task input: use pendingMessageId only in claim_pending_messages, never as source.messageId. First hand off the current request, then claim a selected request and wait for its original user input before registering or delegating it. Do not perform work from contentPreview. Page only when selection needs more candidates." },
      { name: "claim_pending_messages", parameters: modelToolParameters(claimSchema),
        description: "Claim selected independent requests after a successful spawn_subagent or queued send_agent_message to your own child has accepted the current request. It is enough to hand off; do not wait for completion. Related requests can share an assignment. Every selected source ID is retained. Claim again only after arranging this batch. If queue_paused is returned, complete current accepted work and report that the user must resume the queue; do not poll or wait for Agent messages to unpause it." },
    ];
  }

  public execute(input: { toolName: string; arguments: string; conversationId: string; runId: string;
    signal: AbortSignal; queuePaused?: boolean; claim: (ids: string[]) => ConversationPendingMessage[] }) {
    try {
      input.signal.throwIfAborted();
      const args = parseToolArguments(input.arguments);
      if (input.toolName === "list_pending_messages") {
        const { offset, limit } = listSchema.parse(args);
        const queue = this.database.listPendingMessages(input.conversationId).filter(message => message.deliveryMode === "queue");
        return this.success({ state: "preview_only", instruction: "After handing off the current request, call claim_pending_messages with the selected pendingMessageId values. Wait for the original user input at the next model turn before registering tasks or delegating work. Do not use preview IDs as source.messageId or omit a source to work around this boundary.", total: queue.length, nextOffset: offset + limit < queue.length ? offset + limit : null,
          messages: queue.slice(offset, offset + limit).map(message => ({ pendingMessageId: message.id, contentPreview: message.content.slice(0, 1_000),
            truncated: message.content.length > 1_000, attachmentIds: message.attachmentIds })) });
      }
      if (input.toolName !== "claim_pending_messages") throw new Error(`Unknown queue tool: ${input.toolName}`);
      const { pendingMessageIds } = claimSchema.parse(args);
      if (input.queuePaused) return { kind: "completed" as const, isError: true, content: JSON.stringify({
        ok: false, error: "任务队列已暂停，需要用户恢复后才能继续领取。",
        value: { status: "queue_paused", action: "user_resume_required", instruction: "Finish current accepted work and report the pending queue. Do not retry claims, poll or wait for Agent messages to resume a paused queue." },
      }) };
      this.requireHandoff(input.conversationId, input.runId);
      const selected = input.claim(pendingMessageIds);
      return this.success({ pendingMessageIds: selected.map(message => message.id), status: "claimed" });
    } catch (error) {
      return { content: toolErrorContent(error, `tool:${input.toolName}`), isError: true, kind: "completed" as const };
    }
  }

  private success(value: unknown) {
    return { content: JSON.stringify({ ok: true, value }), isError: false, kind: "completed" as const };
  }

  private requireHandoff(conversationId: string, runId: string): void {
    const timeline = this.database.listTimeline(conversationId, runId);
    const latestRequest = timeline.findLastIndex(item => item.kind === "message" && item.role === "user");
    // A result-only wake has no unarranged user input in this Run.
    if (latestRequest < 0) return;
    const accepted = timeline.slice(latestRequest + 1).some(item => {
      if (item.kind !== "tool" || item.status !== "completed") return false;
      if (item.name === "spawn_subagent") return true;
      if (item.name !== "send_agent_message") return false;
      const args = parseToolArguments(item.arguments);
      if (args.expectReply === false || args.deliveryMode === "steer") return false;
      const targets = Array.isArray(args.conversationIds) ? args.conversationIds : [args.conversationId];
      return targets.length > 0 && targets.every(id => typeof id === "string"
        && this.database.hasConversation(id)
        && this.database.getConversation(id).threadKind === "subagent"
        && this.database.getConversation(id).parentConversationId === conversationId);
    });
    if (!accepted) throw new Error("Arrange the current request first: spawn a child or queue an assignment to an existing child, then claim more requests. Failed tools do not count as a handoff.");
  }
}
