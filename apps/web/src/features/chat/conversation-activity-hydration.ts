import type { ConversationRunEvent, ConversationToolItem } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";

export type LiveTool = Pick<ConversationToolItem, "conversationId" | "runId" | "status">
  & Partial<Pick<ConversationToolItem, "name" | "createdAt">>;
export type LiveTools = Record<string, LiveTool>;

export function updateActivityTools(tools: LiveTools, event: ConversationRunEvent): LiveTools {
  if (event.type === "run.finished") return Object.fromEntries(Object.entries(tools).filter(([, tool]) => tool.runId !== event.runId));
  if (event.type !== "tool.started" && event.type !== "tool.completed" && event.type !== "tool.approval_requested") return tools;
  const next = { ...tools };
  if (event.tool.status === "running" || event.tool.status === "awaiting_approval") next[event.tool.id] = {
    conversationId: event.conversationId,
    runId: event.runId,
    status: event.tool.status,
    name: event.tool.name,
    createdAt: event.tool.createdAt,
  };
  else delete next[event.tool.id];
  return next;
}

type Hydration = { conversationId: string; runId: string; status: "queued" | "reading" | "complete" | "failed"; events: ConversationRunEvent[] };

/** A mounted activity view owns one four-reader queue, including reads for runs removed mid-flight. */
export class ConversationActivityHydration {
  private readonly runs = new Map<string, Hydration>();
  private inFlight = 0;
  private retry = 0;
  private disposed = false;

  public constructor(
    private readonly client: Pick<AgentClient, "listConversationTimelinePage">,
    private readonly pendingEvents: Map<string, ConversationRunEvent[]>,
    private readonly onHydrated: (conversationId: string, tools: LiveTools) => void,
    private readonly onError: () => void,
  ) {}

  public update(runs: readonly (readonly [string, string])[], retry: number): void {
    if (this.disposed) return;
    const desired = new Map(runs);
    for (const [id, job] of this.runs) {
      if (desired.get(id) !== job.runId) { this.releaseEvents(job); job.events = []; this.runs.delete(id); }
    }
    for (const [conversationId, runId] of desired) {
      const existing = this.runs.get(conversationId);
      if (existing === undefined) this.runs.set(conversationId, { conversationId, runId, status: "queued", events: [] });
      else if (retry !== this.retry && existing.status === "failed") existing.status = "queued";
    }
    this.retry = retry;
    // StrictMode can clean up and remount effects before this microtask; disposed owners must not start IPC.
    queueMicrotask(() => this.drain());
  }

  public dispose(): void {
    this.disposed = true;
    for (const job of this.runs.values()) this.releaseEvents(job);
    this.runs.clear();
  }

  private current(job: Hydration): boolean {
    return !this.disposed && this.runs.get(job.conversationId) === job;
  }

  private releaseEvents(job: Hydration): void {
    if (this.pendingEvents.get(job.conversationId) === job.events) this.pendingEvents.delete(job.conversationId);
  }

  private drain(): void {
    if (this.disposed) return;
    for (const job of this.runs.values()) {
      if (this.inFlight >= 4) break;
      if (job.status !== "queued") continue;
      job.status = "reading";
      job.events = [];
      this.pendingEvents.set(job.conversationId, job.events);
      this.inFlight++;
      void this.hydrate(job).finally(() => { this.inFlight--; this.drain(); });
    }
  }

  private async hydrate(job: Hydration): Promise<void> {
    let beforeSequence: number | undefined;
    const found: LiveTools = {};
    try {
      while (this.current(job)) {
        const page = await this.client.listConversationTimelinePage({ conversationId: job.conversationId, limit: 50,
          ...(beforeSequence === undefined ? {} : { beforeSequence }) });
        if (!this.current(job)) return;
        for (const item of page.items) {
          if (item.kind === "tool" && item.runId === job.runId
            && (item.status === "running" || item.status === "awaiting_approval")) found[item.id] = {
            conversationId: job.conversationId, runId: job.runId, status: item.status, name: item.name, createdAt: item.createdAt,
          };
        }
        if (!page.hasMore || page.nextBeforeSequence === null || page.nextBeforeSequence === beforeSequence
          || page.items.some(item => "runId" in item && item.runId !== null && item.runId !== job.runId)) break;
        beforeSequence = page.nextBeforeSequence;
      }
      if (this.current(job)) {
        this.onHydrated(job.conversationId, job.events.filter(event => "runId" in event && event.runId === job.runId).reduce(updateActivityTools, found));
        job.status = "complete";
      }
    } catch {
      if (this.current(job)) { job.status = "failed"; this.onError(); }
    } finally {
      this.releaseEvents(job);
      job.events = [];
    }
  }
}
