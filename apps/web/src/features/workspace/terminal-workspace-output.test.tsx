// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession, TerminalSessionEvent, TerminalSessionOutput } from "@agent/protocol";
import { MockAgentClient, type AgentClient } from "../../runtime/index.js";
import { TerminalWorkspace } from "./terminal-workspace.js";

const state = vi.hoisted(() => ({
  output: "", calls: [] as string[],
  observe: (): void => undefined,
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.calls.push(`create:${String(options.cols)}x${String(options.rows)}`);
    }
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    refresh() {}
    clear() { state.output = ""; }
    reset() { state.output = ""; }
    onData() { return { dispose() {} }; }
    resize(columns: number, rows: number) {
      this.cols = columns;
      this.rows = rows;
      state.calls.push(`resize:${columns}x${rows}`);
    }
    write(data: string, callback?: () => void) {
      state.output += data;
      if (data) state.calls.push("write");
      callback?.();
    }
    writeln(data: string) { state.output += `${data}\r\n`; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {
  fit() { state.calls.push("fit"); }
} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {
  onContextLoss() {}
  dispose() {}
} }));

const session: TerminalSession = {
  initialSize: { columns: 120, rows: 32 },
  projectId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  shellLabel: "Windows PowerShell",
  windowsPty: { backend: "conpty", buildNumber: 26100 },
};
let root: Root | null = null;
let emit: (event: TerminalSessionEvent) => void;

beforeEach(() => {
  vi.useFakeTimers();
  state.output = "";
  state.calls = [];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { state.observe = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(client: AgentClient, initialSession: TerminalSession | null = session): void {
  vi.spyOn(client, "onTerminalSessionEvent").mockImplementation((listener: (event: TerminalSessionEvent) => void) => {
    emit = listener;
    return vi.fn();
  });
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  act(() => root?.render(<TerminalWorkspace active agentClient={client}
    projectId={session.projectId} session={initialSession} onError={vi.fn()} onSessionOpened={vi.fn()} />));
}

describe("terminal startup replay", () => {
  it("deduplicates overlapping live output and parses history at its initial size before fitting", async () => {
    const client = new MockAgentClient();
    let resolveHistory: (output: TerminalSessionOutput) => void = () => undefined;
    vi.spyOn(client, "readTerminalSessionOutput").mockImplementation(() => new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    vi.spyOn(client, "resizeTerminalSession").mockResolvedValue(undefined);
    render(client);
    const history = "profile warning\r\nPS> ";
    const command = "ping example.com\r\nReply from 127.0.0.1\r\n";
    emit({ type: "data", sessionId: session.sessionId, data: history + command,
      nextCursor: history.length + command.length });
    await act(async () => {
      resolveHistory({ data: history, nextCursor: history.length, truncated: false });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(state.output).toBe(history + command);
    expect(state.calls.indexOf("resize:120x32")).toBeLessThan(state.calls.indexOf("write"));
    expect(state.calls.indexOf("write")).toBeLessThan(state.calls.indexOf("fit"));
    // A delayed event may already be included in the read response.
    emit({ type: "data", sessionId: session.sessionId, data: command,
      nextCursor: history.length + command.length });
    await vi.advanceTimersByTimeAsync(20);
    expect(state.output).toBe(history + command);
  });

  it("reads all bounded history pages, including startup output before a newly opened session resolves", async () => {
    const client = new MockAgentClient();
    vi.spyOn(client, "openTerminalSession").mockResolvedValue(session);
    const read = vi.spyOn(client, "readTerminalSessionOutput")
      .mockResolvedValueOnce({ data: "startup\r\n", nextCursor: 9, truncated: true })
      .mockResolvedValueOnce({ data: "PS> ", nextCursor: 13, truncated: false });
    vi.spyOn(client, "resizeTerminalSession").mockResolvedValue(undefined);
    render(client, null);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(read).toHaveBeenNthCalledWith(2, {
      afterCursor: 9, maxChars: 65_536, sessionId: session.sessionId,
    });
    expect(state.output).toBe("startup\r\nPS> ");
  });

  it("coalesces layout animation resize notifications and disposes the pending resize", async () => {
    const client = new MockAgentClient();
    vi.spyOn(client, "readTerminalSessionOutput").mockResolvedValue({ data: "PS> ", nextCursor: 4, truncated: false });
    const resize = vi.spyOn(client, "resizeTerminalSession").mockResolvedValue(undefined);
    render(client);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    for (let step = 0; step < 10; step += 1) {
      state.observe();
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(resize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120);
    expect(resize).toHaveBeenCalledOnce();
    state.observe();
    act(() => root?.unmount());
    root = null;
    await vi.advanceTimersByTimeAsync(200);
    expect(resize).toHaveBeenCalledOnce();
  });
});
