import { describe, expect, it, vi } from "vitest";
import { stopDesktopWork } from "./desktop-work-lifecycle.js";

describe("desktop work lifecycle", () => {
  it("stops scheduling and drains runs, commands and PTYs before releasing persistence", async () => {
    const calls: string[] = [];
    let finishRuns: () => void = () => undefined;
    let finishCommands: () => void = () => undefined;
    let finishTerminals: () => void = () => undefined;
    const services = {
      scheduledTasks: { dispose: vi.fn(() => { calls.push("scheduler"); }) },
      agentRuntime: { stopAllRuns: vi.fn(() => { calls.push("runs"); return new Promise<void>((resolve) => { finishRuns = resolve; }); }) },
      workspaceTerminalTabs: { dispose: vi.fn() },
      workspaceBrowserTabs: { dispose: vi.fn() },
      managedBrowser: { dispose: vi.fn() },
      htmlPreviews: { closeAll: vi.fn() },
      tools: { dispose: vi.fn(() => new Promise<void>((resolve) => { finishCommands = resolve; })) },
      terminalSessions: { dispose: vi.fn(() => new Promise<void>((resolve) => { finishTerminals = resolve; })) },
    };
    let completed = false;
    const stopping = stopDesktopWork(services).then(() => { completed = true; calls.push("persistence can close"); });
    expect(calls).toEqual(["scheduler", "runs"]);
    expect(services.managedBrowser.dispose).toHaveBeenCalledOnce();
    expect(services.workspaceBrowserTabs.dispose).toHaveBeenCalledOnce();
    expect(services.workspaceTerminalTabs.dispose).toHaveBeenCalledOnce();
    expect(services.htmlPreviews.closeAll).toHaveBeenCalledOnce();
    finishRuns(); finishCommands();
    await Promise.resolve();
    expect(completed).toBe(false);
    finishTerminals();
    await stopping;
    expect(calls.at(-1)).toBe("persistence can close");
  });

  it("still waits for runs when another resource fails cleanup", async () => {
    let finishRuns: () => void = () => undefined;
    let settled = false;
    const stopping = stopDesktopWork({
      scheduledTasks: { dispose: vi.fn() },
      agentRuntime: { stopAllRuns: () => new Promise<void>((resolve) => { finishRuns = resolve; }) },
      workspaceTerminalTabs: { dispose: vi.fn() }, workspaceBrowserTabs: { dispose: vi.fn() },
      managedBrowser: { dispose: vi.fn() }, htmlPreviews: { closeAll: vi.fn() },
      tools: { dispose: () => Promise.reject(new Error("tree stop failed")) },
      terminalSessions: { dispose: () => Promise.resolve() },
    }).catch((error: unknown) => { settled = true; return error; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    finishRuns();
    await expect(stopping).resolves.toBeInstanceOf(AggregateError);
  });

  it("drains all owned work even when a synchronous browser disposer throws", async () => {
    let finishRuns: () => void = () => undefined;
    const commands = vi.fn(() => Promise.resolve());
    const terminals = vi.fn(() => Promise.resolve());
    let settled = false;
    const stopping = stopDesktopWork({
      scheduledTasks: { dispose: vi.fn() },
      agentRuntime: { stopAllRuns: () => new Promise<void>((resolve) => { finishRuns = resolve; }) },
      workspaceTerminalTabs: { dispose: vi.fn() }, workspaceBrowserTabs: { dispose: vi.fn() },
      managedBrowser: { dispose: () => { throw new Error("BrowserWindow destroyed"); } },
      htmlPreviews: { closeAll: vi.fn() }, tools: { dispose: commands }, terminalSessions: { dispose: terminals },
    }).catch((error: unknown) => { settled = true; return error; });
    try {
      await Promise.resolve(); await Promise.resolve();
      expect(commands).toHaveBeenCalledOnce();
      expect(terminals).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
    } finally { finishRuns(); }
    await expect(stopping).resolves.toBeInstanceOf(AggregateError);
  });
});
