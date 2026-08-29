import { randomUUID } from "node:crypto";

import {
  workspaceBrowserTabCloseRequestSchema,
  workspaceBrowserTabOpenedInputSchema,
  workspaceBrowserTabOpenRequestSchema,
  type ManagedBrowserSession,
  type WorkspaceBrowserTabCloseRequest,
  type WorkspaceBrowserTabOpenRequest,
  type WorkspaceBrowserTabOpenedInput,
} from "@agent/protocol";

const OPEN_REQUEST_TIMEOUT_MS = 10_000;

export type OpenWorkspaceBrowserTabInput = {
  conversationId: string;
  projectId: string;
  requestedName: string | null;
  session: ManagedBrowserSession;
  signal: AbortSignal;
};

export type OpenedWorkspaceBrowserTab = {
  requestedName: string | null;
  resolvedName: string;
};

export type WorkspaceBrowserTabPort = {
  close(input: { conversationId: string; sessionId: string }): void;
  open(input: OpenWorkspaceBrowserTabInput): Promise<OpenedWorkspaceBrowserTab>;
};

export type WorkspaceBrowserTabOpenRequestListener = (
  request: WorkspaceBrowserTabOpenRequest,
) => boolean;

export type WorkspaceBrowserTabCloseRequestListener = (
  request: WorkspaceBrowserTabCloseRequest,
) => boolean;

type PendingOpenRequest = {
  onAbort: () => void;
  reject: (reason: Error) => void;
  request: WorkspaceBrowserTabOpenRequest;
  resolve: (result: OpenedWorkspaceBrowserTab) => void;
  signal: AbortSignal;
  timeout: ReturnType<typeof setTimeout>;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Main owns the Agent browser session, while Renderer owns the visible tab and
 * its global title de-duplication. The acknowledgement joins those lifecycles.
 */
export class WorkspaceBrowserTabController implements WorkspaceBrowserTabPort {
  private readonly closeListeners = new Set<WorkspaceBrowserTabCloseRequestListener>();
  private readonly listeners = new Set<WorkspaceBrowserTabOpenRequestListener>();
  private readonly pending = new Map<string, PendingOpenRequest>();

  public onOpenRequested(listener: WorkspaceBrowserTabOpenRequestListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onCloseRequested(listener: WorkspaceBrowserTabCloseRequestListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  public close(input: { conversationId: string; sessionId: string }): void {
    const request = workspaceBrowserTabCloseRequestSchema.parse(input);
    for (const listener of this.closeListeners) listener(request);
  }

  public open(input: OpenWorkspaceBrowserTabInput): Promise<OpenedWorkspaceBrowserTab> {
    if (input.signal.aborted) return Promise.reject(abortError(input.signal));
    const request = workspaceBrowserTabOpenRequestSchema.parse({
      conversationId: input.conversationId,
      projectId: input.projectId,
      requestedName: input.requestedName,
      requestId: randomUUID(),
      session: input.session,
    });
    return new Promise<OpenedWorkspaceBrowserTab>((resolve, reject) => {
      const settle = (reason?: Error, result?: OpenedWorkspaceBrowserTab): void => {
        const pending = this.pending.get(request.requestId);
        if (pending === undefined) return;
        this.pending.delete(request.requestId);
        clearTimeout(pending.timeout);
        pending.signal.removeEventListener("abort", pending.onAbort);
        if (reason !== undefined) pending.reject(reason);
        else if (result !== undefined) pending.resolve(result);
      };
      const onAbort = (): void => settle(abortError(input.signal));
      const timeout = setTimeout(() => {
        settle(new Error("The workspace did not confirm that the browser tab was opened in time."));
      }, OPEN_REQUEST_TIMEOUT_MS);
      this.pending.set(request.requestId, { onAbort, reject, request, resolve, signal: input.signal, timeout });
      input.signal.addEventListener("abort", onAbort, { once: true });

      let delivered = false;
      for (const listener of this.listeners) delivered = listener(request) || delivered;
      if (!delivered) settle(new Error("The workspace window is unavailable to open a browser tab."));
    });
  }

  public confirmOpened(rawInput: unknown): boolean {
    const input: WorkspaceBrowserTabOpenedInput = workspaceBrowserTabOpenedInputSchema.parse(rawInput);
    const pending = this.pending.get(input.requestId);
    if (pending === undefined) return false;
    this.pending.delete(input.requestId);
    clearTimeout(pending.timeout);
    pending.signal.removeEventListener("abort", pending.onAbort);
    pending.resolve({ requestedName: pending.request.requestedName, resolvedName: input.resolvedName });
    return true;
  }

  public dispose(): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(new Error("The workspace browser tab request was cancelled because the window closed."));
    }
    this.listeners.clear();
    this.closeListeners.clear();
  }
}
