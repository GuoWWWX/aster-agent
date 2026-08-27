export type ActiveRun = {
  conversationId: string;
  controller: AbortController;
  finished: Promise<void>;
  resolveFinished: () => void;
};

/**
 * Owns the in-memory lifecycle of an executing Run. Persistent status remains
 * in AgentDatabase; this class deliberately knows nothing about models, tools,
 * IPC, or Graph execution.
 */
export class RunCoordinator {
  private readonly activeRuns = new Map<string, ActiveRun>();

  private readonly activeRunIdsByConversation = new Map<string, string>();

  private readonly replacingRunIds = new Set<string>();

  public cancel(runId: string): void {
    this.activeRuns
      .get(runId)
      ?.controller.abort(new DOMException("Run cancelled by the user.", "AbortError"));
  }

  public complete(runId: string): { activeRun: ActiveRun | undefined; wasReplacing: boolean } {
    const activeRun = this.activeRuns.get(runId);
    this.activeRuns.delete(runId);
    if (activeRun !== undefined && this.activeRunIdsByConversation.get(activeRun.conversationId) === runId) {
      this.activeRunIdsByConversation.delete(activeRun.conversationId);
    }
    activeRun?.resolveFinished();
    return { activeRun, wasReplacing: this.replacingRunIds.delete(runId) };
  }

  public get(runId: string): ActiveRun | undefined {
    return this.activeRuns.get(runId);
  }

  public getActiveForConversation(conversationId: string): ActiveRun | undefined {
    const runId = this.activeRunIdsByConversation.get(conversationId);
    return runId === undefined ? undefined : this.activeRuns.get(runId);
  }

  public register(
    runId: string,
    controller: AbortController,
    conversationId = runId,
  ): ActiveRun {
    if (this.activeRuns.has(runId)) {
      throw new Error("Run is already registered as active.");
    }
    if (this.activeRunIdsByConversation.has(conversationId)) {
      throw new Error("Conversation already has an active Run.");
    }
    let resolveFinished = (): void => undefined;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const activeRun = { conversationId, controller, finished, resolveFinished };
    this.activeRuns.set(runId, activeRun);
    this.activeRunIdsByConversation.set(conversationId, runId);
    return activeRun;
  }

  public markReplacing(runId: string): void {
    this.replacingRunIds.add(runId);
  }

  public schedule(
    runId: string,
    conversationId: string,
    execute: (controller: AbortController) => Promise<void>,
  ): ActiveRun {
    const controller = new AbortController();
    const activeRun = this.register(runId, controller, conversationId);
    setImmediate(() => {
      void execute(controller);
    });
    return activeRun;
  }
}
