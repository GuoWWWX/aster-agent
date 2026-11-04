import { appUpdateStateSchema, IPC_CHANNELS } from "@agent/protocol";
import type { IpcMainInvokeEvent } from "electron";
import type { AppUpdateController } from "../updates/app-update-controller.js";
import { getTrustedWindow, parseNoArguments, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";

export function registerAppUpdateHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  updates: AppUpdateController,
): void {
  const validate = (event: IpcMainInvokeEvent, args: unknown[]): void => {
    getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Rejected update request from a subframe.");
    parseNoArguments(args);
  };
  ipcMain.handle(IPC_CHANNELS.appUpdateGetState, (event, ...args: unknown[]) => {
    validate(event, args); return appUpdateStateSchema.parse(updates.getState());
  });
  ipcMain.handle(IPC_CHANNELS.appUpdateCheck, async (event, ...args: unknown[]) => {
    validate(event, args); return appUpdateStateSchema.parse(await updates.check());
  });
  ipcMain.handle(IPC_CHANNELS.appUpdateDownload, (event, ...args: unknown[]) => {
    validate(event, args); return appUpdateStateSchema.parse(updates.download());
  });
  ipcMain.handle(IPC_CHANNELS.appUpdatePause, async (event, ...args: unknown[]) => {
    validate(event, args); return appUpdateStateSchema.parse(await updates.pause());
  });
  ipcMain.handle(IPC_CHANNELS.appUpdateInstall, (event, ...args: unknown[]) => {
    validate(event, args); return appUpdateStateSchema.parse(updates.install());
  });
}
