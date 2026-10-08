import type { ProjectRegistry } from "../projects/project-registry.js";
import {
  AgentDatabase,
  type ConversationDeletionTask,
} from "./agent-database.js";

export type ConversationDeletionFileStore = {
  deleteUnreferencedConversationFiles(
    conversationIds: readonly string[],
    candidateFiles: readonly string[],
  ): Promise<void>;
};

export type ConversationDeletionCheckpointStore = {
  deleteThreads(threadIds: readonly string[]): Promise<void>;
};

export type ConversationDeletionThreadLogStore = {
  deleteConversations(conversationIds: readonly string[]): Promise<void>;
};

export type ConversationDeletionOutcome = "completed" | "pending";

function describeDeletionError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = "code" in error && typeof error.code === "string" ? `[${error.code}] ` : "";
  return `${code}${error.message}`;
}

export class ConversationDeletionService {
  private readonly undoableTasks = new Map<string, string>();
  private readonly inFlightTasks = new Map<string, Promise<ConversationDeletionOutcome>>();

  public constructor(
    private readonly database: AgentDatabase,
    private readonly files: ConversationDeletionFileStore,
    private readonly projects: Pick<ProjectRegistry, "unmountConversationWorkspace">,
    private readonly checkpoints: ConversationDeletionCheckpointStore | null = null,
    private readonly threadLogs: ConversationDeletionThreadLogStore | null = null,
  ) {}

  public async requestDeletion(conversationId: string): Promise<ConversationDeletionOutcome> {
    const task = this.database.createConversationDeletionTask(conversationId);
    this.unmountTaskWorkspaces(task);
    return await this.processTask(task.id);
  }

  public async resumeIncompleteTasks(): Promise<void> {
    for (const task of this.database.listIncompleteConversationDeletionTasks()) {
      if (this.undoableTasks.get(task.rootConversationId) === task.id) continue;
      this.unmountTaskWorkspaces(task);
      await this.processTask(task.id);
    }
  }

  public requestUndoableDeletion(conversationId: string): void {
    const task = this.database.createConversationDeletionTask(conversationId);
    if (task.rootConversationId !== conversationId || task.status !== "pending" || task.retryCount !== 0) {
      throw new Error("Conversation deletion cannot be held for undo.");
    }
    // Persist the deletion intent, but retain all files and relations until the
    // next process startup. Only this process owns permission to undo it.
    this.undoableTasks.set(conversationId, task.id);
  }

  public restoreDeletedConversation(conversationId: string): void {
    const taskId = this.undoableTasks.get(conversationId);
    if (taskId === undefined) throw new Error("Conversation deletion can no longer be undone.");
    this.database.cancelPendingConversationDeletion(taskId);
    this.undoableTasks.delete(conversationId);
  }

  public async deleteExpiredArchivedConversations(cutoffIso: string): Promise<void> {
    for (const conversationId of this.database.listExpiredArchivedConversationRootIds(cutoffIso)) {
      await this.requestDeletion(conversationId);
    }
  }

  private processTask(taskId: string): Promise<ConversationDeletionOutcome> {
    const active = this.inFlightTasks.get(taskId);
    if (active !== undefined) return active;

    const operation = this.executeTask(taskId).finally(() => {
      this.inFlightTasks.delete(taskId);
    });
    this.inFlightTasks.set(taskId, operation);
    return operation;
  }

  private async executeTask(taskId: string): Promise<ConversationDeletionOutcome> {
    const task = this.database.beginConversationDeletionTask(taskId);
    if (task === null) return "completed";

    try {
      await this.files.deleteUnreferencedConversationFiles(
        task.conversationIds,
        task.filePaths,
      );
      if (this.checkpoints !== null) {
        await this.checkpoints.deleteThreads(
          this.database.listRunIdsForConversations(task.conversationIds),
        );
      }
      if (this.threadLogs !== null) {
        await this.threadLogs.deleteConversations(task.conversationIds);
      }
      this.database.completeConversationDeletionTask(task.id);
      return "completed";
    } catch (error) {
      this.database.failConversationDeletionTask(task.id, describeDeletionError(error));
      return "pending";
    }
  }

  private unmountTaskWorkspaces(task: ConversationDeletionTask): void {
    for (const conversationId of task.conversationIds) {
      this.projects.unmountConversationWorkspace(conversationId);
    }
  }
}
