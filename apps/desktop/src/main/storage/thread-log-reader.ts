import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ThreadLog } from "./thread-log.js";
import type { ThreadLogReadIndexLoader, ThreadLogReadIndexes } from "./thread-log-read-index.js";
import type { ThreadLogReaderResponse } from "./thread-log-reader-worker.js";

type Pending = {
  key: string;
  requestId: number;
  root: string;
  conversationId: string;
  resolve: (snapshot: ThreadLogReadIndexes | null) => void;
  reject: (error: Error) => void;
};

/** One lazy worker for the application; cold reads are deduplicated and serialized. */
export class ThreadLogReader implements ThreadLogReadIndexLoader {
  private worker: Worker | undefined;
  private active: Pending | undefined;
  private readonly queue: Pending[] = [];
  private readonly pending = new Map<string, Promise<ThreadLogReadIndexes | null>>();
  private sequence = 0;
  private disposed = false;

  public constructor(private readonly workerPath: string) {}

  public read(log: ThreadLog, conversationId: string): Promise<ThreadLogReadIndexes | null> {
    if (this.disposed) return Promise.reject(new Error("Conversation reader has stopped."));
    const root = path.dirname(path.dirname(log.getPath(conversationId)));
    const key = `${root}:${conversationId}`;
    const existing = this.pending.get(key);
    if (existing !== undefined) return existing;
    if (this.queue.length >= 32) return Promise.reject(new Error("Conversation reader queue is full."));
    const promise = new Promise<ThreadLogReadIndexes | null>((resolve, reject) => {
      this.queue.push({ key, root, conversationId, requestId: ++this.sequence, resolve, reject });
    });
    this.pending.set(key, promise);
    this.drain();
    return promise;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    const worker = this.worker;
    this.worker = undefined;
    this.fail(new Error("Conversation reader has stopped."));
    if (worker !== undefined) await worker.terminate();
  }

  private drain(): void {
    if (this.disposed || this.active !== undefined) return;
    const next = this.queue.shift();
    if (next === undefined) { this.worker?.unref(); return; }
    this.active = next;
    try {
      if (this.worker === undefined) {
        const worker = new Worker(this.workerPath, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
        this.worker = worker;
        worker.on("message", (response: ThreadLogReaderResponse) => {
          if (this.worker !== worker || this.active?.requestId !== response.requestId) return;
          const current = this.active;
          this.active = undefined;
          this.pending.delete(current.key);
          if (response.ok) current.resolve(response.snapshot);
          else if (response.error === "THREAD_LOG_READER_INCOMPLETE") current.resolve(null);
          else current.reject(new Error(response.error));
          this.drain();
        });
        worker.on("error", (error: unknown) => { if (this.worker === worker) { this.worker = undefined; this.fail(error instanceof Error ? error : new Error("Conversation reader failed.")); } });
        worker.on("exit", code => {
          if (this.worker !== worker) return;
          this.worker = undefined;
          this.fail(new Error(`Conversation reader exited (${code}).`));
        });
      }
      this.worker.ref();
      this.worker.postMessage({ requestId: next.requestId, root: next.root, conversationId: next.conversationId });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("Conversation reader could not start."));
    }
  }

  private fail(error: Error): void {
    if (this.active !== undefined) this.active.reject(error);
    for (const item of this.queue.splice(0)) item.reject(error);
    this.active = undefined;
    this.pending.clear();
  }
}
