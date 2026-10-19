import { dialog } from "electron";
import {
  APPLICATION_DISPLAY_NAME,
  applicationStorageLocationSchema,
  applicationSettingsIpcArgumentsSchema,
  applicationSettingsSchema,
  contextCompressionConfigurationIpcArgumentsSchema,
  contextCompressionConfigurationSchema,
  integrationConfigurationIpcArgumentsSchema,
  integrationConfigurationSchema,
  IPC_CHANNELS,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerApplicationSettingsHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { applicationSettings }: Pick<MainIpcDependencies, "applicationSettings">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return applicationSettingsSchema.parse(applicationSettings.getConfiguration());
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = applicationSettingsIpcArgumentsSchema.parse(args);
      return applicationSettingsSchema.parse(applicationSettings.saveConfiguration(input));
    },
  );
}

export function registerStorageAndIntegrationSettingsHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { applicationStorageLocation, contextCompression, configurationWorkspaces, integrationConfiguration }: Pick<MainIpcDependencies, "applicationStorageLocation" | "contextCompression" | "configurationWorkspaces" | "integrationConfiguration">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsGetStorageLocation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return applicationStorageLocationSchema.parse(
        applicationStorageLocation.getLocation(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsChooseStorageLocation,
    async (event, ...args: unknown[]) => {
      const window = getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      const current = applicationStorageLocation.getLocation();
      if (!current.canChange) return current;
      const selection = await dialog.showOpenDialog(window, {
        defaultPath: current.configuredPath,
        properties: ["openDirectory"],
        title: `选择 ${APPLICATION_DISPLAY_NAME} 数据存储目录`,
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || selectedPath === undefined) return null;
      return applicationStorageLocationSchema.parse(
        applicationStorageLocation.selectLocation(selectedPath),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsResetStorageLocation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return applicationStorageLocationSchema.parse(
        applicationStorageLocation.resetLocation(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.contextCompressionGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return contextCompressionConfigurationSchema.parse(
        contextCompression.getConfiguration()
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.contextCompressionSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = contextCompressionConfigurationIpcArgumentsSchema.parse(args);
      return contextCompressionConfigurationSchema.parse(
        contextCompression.saveConfiguration(input)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.integrationGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return integrationConfigurationSchema.parse(
        integrationConfiguration.getConfiguration()
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.integrationSaveConfiguration,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = integrationConfigurationIpcArgumentsSchema.parse(args);
      const saved = integrationConfiguration.saveConfiguration(input);
      await configurationWorkspaces.synchronizeMcpDocuments(saved);
      return integrationConfigurationSchema.parse(
        saved
      );
    }
  );
}
