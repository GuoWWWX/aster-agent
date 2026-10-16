type DesktopWork = {
  agentRuntime: { stopAllRuns(): Promise<void> };
  scheduledTasks: { dispose(): void };
  managedBrowser: { dispose(): void };
  htmlPreviews: { closeAll(): void };
  terminalSessions: { dispose(): Promise<void> };
  workspaceTerminalTabs: { dispose(): void };
  workspaceBrowserTabs: { dispose(): void };
  tools: { dispose(): Promise<void> };
};

/** The database and graph store must remain open until all owned work drains. */
export async function stopDesktopWork(services: DesktopWork): Promise<void> {
  const cleanups = [
    () => services.scheduledTasks.dispose(),
    () => services.agentRuntime.stopAllRuns(),
    () => services.workspaceTerminalTabs.dispose(),
    () => services.workspaceBrowserTabs.dispose(),
    () => services.managedBrowser.dispose(),
    () => services.htmlPreviews.closeAll(),
    () => services.tools.dispose(),
    () => services.terminalSessions.dispose(),
  ];
  const results = await Promise.allSettled(cleanups.map(async (cleanup) => { await Promise.resolve(cleanup()); }));
  const errors: unknown[] = [];
  for (const result of results) { if (result.status === "rejected") errors.push(result.reason); }
  if (errors.length > 0) throw new AggregateError(errors, "Desktop work cleanup failed.");
}
