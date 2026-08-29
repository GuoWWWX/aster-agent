import { IPC_CHANNELS, type IpcChannel } from "@agent/protocol";

type IpcMainHandlerAdapter<THandler> = {
  handle(channel: string, handler: THandler): void;
  removeHandler(channel: string): void;
};

const IPC_EVENT_CHANNELS: ReadonlySet<IpcChannel> = new Set([
  IPC_CHANNELS.applicationSettingsChanged,
  IPC_CHANNELS.conversationRunEvent,
  IPC_CHANNELS.managedBrowserEvent,
  IPC_CHANNELS.terminalSessionEvent,
  IPC_CHANNELS.workspaceTerminalOpenRequested,
  IPC_CHANNELS.workspaceBrowserOpenRequested,
  IPC_CHANNELS.workspaceBrowserCloseRequested,
  IPC_CHANNELS.windowStateChanged,
]);

export const DESKTOP_IPC_HANDLER_CHANNELS: readonly IpcChannel[] = Object.values(
  IPC_CHANNELS,
).filter((channel) => !IPC_EVENT_CHANNELS.has(channel));

export function createIpcHandlerRegistrar<THandler>(
  adapter: IpcMainHandlerAdapter<THandler>,
) {
  const registeredChannels = new Set<string>();

  function handle(channel: string, handler: THandler): void {
    if (registeredChannels.has(channel)) {
      throw new Error(`IPC handler is already registered: ${channel}`);
    }
    adapter.handle(channel, handler);
    registeredChannels.add(channel);
  }

  function assertRegisteredChannels(expectedChannels: readonly string[]): void {
    const expected = new Set(expectedChannels);
    const missing = expectedChannels.filter((channel) => !registeredChannels.has(channel));
    const unexpected = [...registeredChannels].filter((channel) => !expected.has(channel));
    if (missing.length === 0 && unexpected.length === 0) return;

    throw new Error(
      `IPC handler registration mismatch. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }

  function dispose(): void {
    for (const channel of [...registeredChannels]) {
      adapter.removeHandler(channel);
      registeredChannels.delete(channel);
    }
  }

  return { assertRegisteredChannels, dispose, handle };
}
