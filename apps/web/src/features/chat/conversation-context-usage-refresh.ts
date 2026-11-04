import type { ConversationContextUsage, ConversationContextUsageInput } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";

type Measurement = {
  input: ConversationContextUsageInput;
  onResult: (usage: ConversationContextUsage) => void;
  onError: () => void;
};
type Scope = { key: string; running: boolean; pending: Measurement | undefined; latest: Measurement | undefined };

/** Each parameter scope retains one IPC read and at most one refresh; switching owners never waits on an old IPC. */
export class ConversationContextUsageRefresh {
  private readonly scopes = new Map<string, Scope>();
  private activeKey: string | undefined;
  private disposed = false;

  public constructor(private readonly client: Pick<AgentClient, "getConversationContextUsage">) {}

  public request(input: ConversationContextUsageInput, onResult: Measurement["onResult"], onError: Measurement["onError"]): void {
    if (this.disposed) return;
    const key = JSON.stringify(input);
    if (this.activeKey !== key) { this.invalidate(); this.activeKey = key; }
    let scope = this.scopes.get(key);
    if (scope === undefined) { scope = { key, running: false, pending: undefined, latest: undefined }; this.scopes.set(key, scope); }
    scope.pending = scope.latest = { input, onResult, onError };
    this.drain(scope);
  }

  /** Pending IPC cannot be cancelled; invalidate its callbacks and retain its in-flight slot. */
  public invalidate(): boolean {
    let unfinished = false;
    for (const [key, scope] of this.scopes) {
      unfinished ||= scope.latest !== undefined;
      scope.latest = scope.pending = undefined;
      if (!scope.running) this.scopes.delete(key);
    }
    return unfinished;
  }

  public dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  private drain(scope: Scope): void {
    const measurement = scope.pending;
    if (scope.running || this.disposed || measurement === undefined) return;
    scope.pending = undefined;
    scope.running = true;
    void this.read(scope, measurement);
  }

  private async read(scope: Scope, measurement: Measurement): Promise<void> {
    try {
      const usage = await this.client.getConversationContextUsage(measurement.input);
      if (!this.disposed && this.activeKey === scope.key && scope.latest === measurement) measurement.onResult(usage);
    } catch {
      if (!this.disposed && this.activeKey === scope.key && scope.latest === measurement) measurement.onError();
    } finally {
      scope.running = false;
      if (scope.latest === measurement) scope.latest = undefined;
      this.drain(scope);
      if (!scope.running && this.activeKey !== scope.key) this.scopes.delete(scope.key);
    }
  }
}
