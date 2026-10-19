import { app, dialog } from "electron";
import { z } from "zod";
import {
  browserConfigurationIpcArgumentsSchema,
  browserConfigurationSchema,
  browserSavedPasswordListSchema,
  browserPasswordReferenceIpcArgumentsSchema,
  browserPasswordValueSchema,
  IPC_CHANNELS,
  managedBrowserCommandIpcArgumentsSchema,
  managedBrowserNavigateIpcArgumentsSchema,
  managedBrowserOpenIpcArgumentsSchema,
  managedBrowserReferenceIpcArgumentsSchema,
  managedBrowserSessionSchema,
  managedBrowserSnapshotSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerBrowserSettingsHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { browserConfiguration, managedBrowser }: Pick<MainIpcDependencies, "browserConfiguration" | "managedBrowser">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.browserGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return browserConfigurationSchema.parse(
        browserConfiguration.getConfiguration(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.browserSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = browserConfigurationIpcArgumentsSchema.parse(args);
      const saved = browserConfigurationSchema.parse(
        browserConfiguration.saveConfiguration(input),
      );
      managedBrowser.applyConfiguration(saved);
      return saved;
    },
  );

  ipcMain.handle(IPC_CHANNELS.browserChooseDownloadDirectory, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    const selection = await dialog.showOpenDialog(window, {
      title: "选择下载目录",
      defaultPath: browserConfiguration.getConfiguration().downloadDirectory || app.getPath("downloads"),
      properties: ["openDirectory", "createDirectory"],
    });
    return z.string().max(4096).nullable().parse(selection.canceled ? null : selection.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.browserGetDefaultDownloadDirectory, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return z.string().min(1).max(4096).parse(app.getPath("downloads"));
  });
  ipcMain.handle(IPC_CHANNELS.browserGetSavedPasswords, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Rejected password request from a subframe.");
    parseNoArguments(args);
    return browserSavedPasswordListSchema.parse(managedBrowser.getSavedPasswords());
  });
  ipcMain.handle(IPC_CHANNELS.browserRevealPassword, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Rejected password request from a subframe.");
    const [input] = browserPasswordReferenceIpcArgumentsSchema.parse(args);
    return browserPasswordValueSchema.parse(managedBrowser.revealPassword(input));
  });

  ipcMain.handle(
    IPC_CHANNELS.browserClearData,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      await managedBrowser.clearBrowsingData();
    },
  );
}

export function registerManagedBrowserHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { database, managedBrowser }: Pick<MainIpcDependencies, "database" | "managedBrowser">,
): void {
  ipcMain.handle(IPC_CHANNELS.managedBrowserOpen, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserOpenIpcArgumentsSchema.parse(args);
    if (input.conversationId !== undefined) database.getConversation(input.conversationId);
    return managedBrowserSessionSchema.parse(await managedBrowser.open(input));
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserNavigate, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserNavigateIpcArgumentsSchema.parse(args);
    await managedBrowser.navigate(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserCommand, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserCommandIpcArgumentsSchema.parse(args);
    await managedBrowser.command(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserCapture, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserReferenceIpcArgumentsSchema.parse(args);
    return managedBrowserSnapshotSchema.parse(await managedBrowser.capture(input));
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserClose, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserReferenceIpcArgumentsSchema.parse(args);
    managedBrowser.close(input);
    return voidIpcResponseSchema.parse(undefined);
  });
}
