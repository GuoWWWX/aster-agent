import { IPC_CHANNELS, type ConversationRunEvent } from "@agent/protocol";

type StreamEvent = Extract<ConversationRunEvent, { type: "assistant.delta" | "assistant.reasoning_delta" | "tool.output_delta" }>;
type StreamTarget = { send(channel: string, event: ConversationRunEvent): void; isDestroyed(): boolean };

function isStream(event: ConversationRunEvent): event is StreamEvent {
  return event.type === "assistant.delta" || event.type === "assistant.reasoning_delta" || event.type === "tool.output_delta";
}

function streamKey(event: StreamEvent): string {
  return `${event.conversationId}:${event.runId}:${event.type}:${"messageId" in event ? event.messageId : event.toolId}:${"kind" in event ? event.kind : "stream" in event ? event.stream : ""}`;
}

function merge(previous: StreamEvent | undefined, event: StreamEvent): StreamEvent {
  const delta = previous === undefined || event.reset ? event.delta : previous.delta + event.delta;
  return event.type === "tool.output_delta" && delta.length > 65_536
    ? { ...event, delta: delta.slice(-65_536), truncated: true, reset: event.reset || previous?.reset || false }
    : { ...event, delta, reset: event.reset || previous?.reset || false };
}

/** Owns volatile output snapshots and routes bounded updates to visible conversations. */
export class ConversationStreamSubscriptions {
  private readonly subscriptions = new WeakMap<StreamTarget, ReadonlySet<string>>();
  private readonly snapshots = new Map<string, StreamEvent>();
  private readonly pending = new Map<StreamTarget, Map<string, StreamEvent>>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  public subscribe(target: StreamTarget, conversationIds: readonly string[]): void {
    this.flush();
    const ids = new Set(conversationIds);
    this.subscriptions.set(target, ids);
    for (const event of this.snapshots.values()) {
      if (ids.has(event.conversationId) && !target.isDestroyed()) {
        target.send(IPC_CHANNELS.conversationRunEvent, { ...event, reset: true });
      }
    }
  }

  public publish(target: StreamTarget | undefined, event: ConversationRunEvent): void {
    if (isStream(event)) {
      const key = streamKey(event);
      if (event.type === "tool.output_delta" && event.status !== "running") {
        for (const [snapshotKey, snapshot] of this.snapshots) {
          if (snapshot.type === "tool.output_delta" && snapshot.toolId === event.toolId) this.snapshots.delete(snapshotKey);
        }
      } else this.snapshots.set(key, merge(this.snapshots.get(key), event));
      if (target === undefined || !this.subscriptions.get(target)?.has(event.conversationId)) return;
      const pending = this.pending.get(target) ?? new Map<string, StreamEvent>();
      pending.set(key, merge(pending.get(key), event));
      this.pending.set(target, pending);
      if (this.timer === undefined) {
        this.timer = setTimeout(() => this.flush(), 32);
        this.timer.unref();
      }
      return;
    }
    this.flush();
    if (event.type === "run.started" || event.type === "run.finished" || event.type === "model.request_started" || event.type === "tool.started" || event.type === "tool.completed") {
      for (const [key, snapshot] of this.snapshots) {
        if (snapshot.conversationId !== event.conversationId) continue;
        if (event.type === "run.started" && snapshot.type !== "tool.output_delta") { this.snapshots.delete(key); continue; }
        if (snapshot.runId !== event.runId) continue;
        if ((event.type === "run.finished" && snapshot.type !== "tool.output_delta")
          || (event.type === "tool.completed" && snapshot.type === "tool.output_delta" && snapshot.toolId === event.tool.id && snapshot.status !== "running")
          || ((event.type === "model.request_started" || event.type === "tool.started") && snapshot.type !== "tool.output_delta")) {
          this.snapshots.delete(key);
        }
      }
    }
    if (target !== undefined && !target.isDestroyed()) target.send(IPC_CHANNELS.conversationRunEvent, event);
  }

  public dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.snapshots.clear();
  }

  private flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const [target, events] of this.pending) {
      if (target.isDestroyed()) continue;
      const ids = this.subscriptions.get(target);
      for (const event of events.values()) {
        if (ids?.has(event.conversationId)) target.send(IPC_CHANNELS.conversationRunEvent, event);
      }
    }
    this.pending.clear();
  }
}
