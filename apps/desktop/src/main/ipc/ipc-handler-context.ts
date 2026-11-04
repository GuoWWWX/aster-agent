import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { emptyIpcArgumentsSchema } from "@agent/protocol";

export type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export type IpcHandlerRegistrationContext = {
  ipcMain: { handle(channel: string, handler: IpcHandler): void };
  getMainWindow: () => BrowserWindow | undefined;
};

export function parseNoArguments(args: unknown[]): void {
  emptyIpcArgumentsSchema.parse(args);
}

export function getTrustedWindow(
  event: Pick<IpcMainInvokeEvent, "sender">,
  getMainWindow: () => BrowserWindow | undefined
): BrowserWindow {
  const mainWindow = getMainWindow();
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  if (
    mainWindow === undefined ||
    mainWindow.isDestroyed() ||
    senderWindow === null ||
    senderWindow !== mainWindow
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }

  return mainWindow;
}
