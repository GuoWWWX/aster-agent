import { randomUUID } from "node:crypto";

import {
  workspaceTerminalTabOpenedInputSchema,
  workspaceTerminalTabOpenRequestSchema,
  type TerminalSession,
  type WorkspaceTerminalTabOpenRequest,
  type WorkspaceTerminalTabOpenedInput,
} from "@agent/protocol";

const OPEN_REQUEST_TIMEOUT_MS = 10_000;

export type OpenWorkspaceTerminalTabInput = {
  conversationId: string;
  projectId: string;
  requestedName: string | null;
  signal: AbortSignal;
  session: TerminalSession;
};

export type OpenedWorkspaceTerminalTab = {
  requestedName: string | null;
  resolvedName: string;
};

export type WorkspaceTerminalTabPort = {
  open(input: OpenWorkspaceTerminalTabInput): Promise<OpenedWorkspaceTerminalTab>;
};

export type WorkspaceTerminalTabOpenRequestListener = (
  request: WorkspaceTerminalTabOpenRequest,
) => boolean;

type PendingOpenRequest = {
  onAbort: () => void;
  reject: (reason: Error) => void;
  request: WorkspaceTerminalTabOpenRequest;
  resolve: (result: OpenedWorkspaceTerminalTab) => void;
  signal: AbortSignal;
  timeout: ReturnType<typeof setTimeout>;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Bridges the model tool in Main and the Renderer-owned terminal tab state.
 * The Renderer owns title de-duplication because it knows every open workspace tab.
 */
export class WorkspaceTerminalTabController {
  private readonly listeners = new Set<WorkspaceTerminalTabOpenRequestListener>();

  private readonly pending = new Map<string, PendingOpenRequest>();

  public onOpenRequested(listener: WorkspaceTerminalTabOpenRequestListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public open(input: OpenWorkspaceTerminalTabInput): Promise<OpenedWorkspaceTerminalTab> {
    if (input.signal.aborted) return Promise.reject(abortError(input.signal));

    const request = workspaceTerminalTabOpenRequestSchema.parse({
      conversationId: input.conversationId,
      projectId: input.projectId,
      requestedName: input.requestedName,
      requestId: randomUUID(),
      session: input.session,
    });

    return new Promise<OpenedWorkspaceTerminalTab>((resolve, reject) => {
      const settle = (reason?: Error, result?: OpenedWorkspaceTerminalTab): void => {
        const pending = this.pending.get(request.requestId);
        if (pending === undefined) return;
        this.pending.delete(request.requestId);
        clearTimeout(pending.timeout);
        pending.signal.removeEventListener("abort", pending.onAbort);
        if (reason !== undefined) {
          pending.reject(reason);
        } else if (result !== undefined) {
          pending.resolve(result);
        }
      };
      const onAbort = (): void => settle(abortError(input.signal));
      const timeout = setTimeout(() => {
        settle(new Error("The workspace did not confirm that the terminal tab was opened in time."));
      }, OPEN_REQUEST_TIMEOUT_MS);

      this.pending.set(request.requestId, {
        onAbort,
        reject,
        request,
        resolve,
        signal: input.signal,
        timeout,
      });
      input.signal.addEventListener("abort", onAbort, { once: true });

      let delivered = false;
      for (const listener of this.listeners) {
        delivered = listener(request) || delivered;
      }
      if (!delivered) {
        settle(new Error("The workspace window is unavailable to open a terminal tab."));
      }
    });
  }

  public confirmOpened(rawInput: unknown): boolean {
    const input: WorkspaceTerminalTabOpenedInput = workspaceTerminalTabOpenedInputSchema.parse(rawInput);
    const pending = this.pending.get(input.requestId);
    if (pending === undefined) return false;

    this.pending.delete(input.requestId);
    clearTimeout(pending.timeout);
    pending.signal.removeEventListener("abort", pending.onAbort);
    pending.resolve({
      requestedName: pending.request.requestedName,
      resolvedName: input.resolvedName,
    });
    return true;
  }

  public dispose(): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(new Error("The workspace terminal tab request was cancelled because the window closed."));
    }
    this.listeners.clear();
  }
}
