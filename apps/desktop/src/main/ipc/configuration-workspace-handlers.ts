import {
  configurationWorkspaceDirectoryListingSchema,
  configurationWorkspaceEntrySchema,
  configurationWorkspaceFileSchema,
  createConfigurationWorkspaceEntryIpcArgumentsSchema,
  deleteConfigurationWorkspaceEntryIpcArgumentsSchema,
  IPC_CHANNELS,
  listConfigurationWorkspaceEntriesIpcArgumentsSchema,
  readConfigurationWorkspaceFileIpcArgumentsSchema,
  writeConfigurationWorkspaceFileIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerConfigurationWorkspaceHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { configurationWorkspaces }: Pick<MainIpcDependencies, "configurationWorkspaces">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceListEntries,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listConfigurationWorkspaceEntriesIpcArgumentsSchema.parse(args);
      return configurationWorkspaceDirectoryListingSchema.parse(
        await configurationWorkspaces.listEntries(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceReadFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readConfigurationWorkspaceFileIpcArgumentsSchema.parse(args);
      return configurationWorkspaceFileSchema.parse(
        await configurationWorkspaces.readFile(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceCreateEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createConfigurationWorkspaceEntryIpcArgumentsSchema.parse(args);
      return configurationWorkspaceEntrySchema.parse(
        await configurationWorkspaces.createEntry(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceWriteFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = writeConfigurationWorkspaceFileIpcArgumentsSchema.parse(args);
      return configurationWorkspaceFileSchema.parse(
        await configurationWorkspaces.writeFile(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceDeleteEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteConfigurationWorkspaceEntryIpcArgumentsSchema.parse(args);
      await configurationWorkspaces.deleteEntry(input);
      return voidIpcResponseSchema.parse(undefined);
    },
  );
}
