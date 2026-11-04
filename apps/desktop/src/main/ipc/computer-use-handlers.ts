import { app, dialog } from "electron";
import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import { IPC_CHANNELS } from "@agent/protocol";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { realpathSync } from "node:fs";
import {
  computerApplicationIconsSchema,
  computerApplicationSchema,
  computerUseConfigurationSchema,
  computerUseStatusSchema,
  saveComputerUseConfigurationArgumentsSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerComputerUseHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { computerUseConfiguration, computerUse }: Pick<MainIpcDependencies, "computerUseConfiguration" | "computerUse">,
): void {
  ipcMain.handle(IPC_CHANNELS.computerUseGetConfiguration, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); parseNoArguments(args);
    return computerUseConfigurationSchema.parse(computerUseConfiguration.getConfiguration());
  });
  ipcMain.handle(IPC_CHANNELS.computerUseSaveConfiguration, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input, baselineApplications] = saveComputerUseConfigurationArgumentsSchema.parse(args);
    const saved = computerUseConfiguration.saveConfiguration(input, baselineApplications);
    computerUse.stop();
    return computerUseConfigurationSchema.parse(saved);
  });
  ipcMain.handle(IPC_CHANNELS.computerUseGetStatus, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); parseNoArguments(args);
    return computerUseStatusSchema.parse(computerUse.getStatus());
  });
  ipcMain.handle(IPC_CHANNELS.computerUseStart, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); parseNoArguments(args);
    return computerUseStatusSchema.parse(await computerUse.start());
  });
  ipcMain.handle(IPC_CHANNELS.computerUseStop, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); parseNoArguments(args); computerUse.stop();
  });
  ipcMain.handle(IPC_CHANNELS.computerUseChooseApplication, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow); parseNoArguments(args);
    const result = await dialog.showOpenDialog(window, { title: "选择软件", properties: ["openFile"], filters: [{ name: "Windows 软件", extensions: ["exe"] }] });
    const selected = result.filePaths[0];
    if (result.canceled || selected === undefined) return null;
    const executablePath = realpathSync(selected);
    return computerApplicationSchema.parse({ id: randomUUID(), name: path.basename(executablePath, path.extname(executablePath)), executablePath, enabled: true });
  });
  ipcMain.handle(IPC_CHANNELS.computerUseGetApplicationIcons, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); parseNoArguments(args);
    const configuration = computerUseConfiguration.getConfiguration();
    const icons = await Promise.all([...configuration.applications, ...configuration.blockedApplications].map(async (application) => {
      try {
        const icon = await app.getFileIcon(application.executablePath, { size: "normal" });
        return [application.id, icon.isEmpty() ? null : icon.resize({ width: 32, height: 32 }).toDataURL()] as const;
      } catch (error) {
        reportMainError(toMainAgentError(error, { operation: "computer_use.application_icon" }), error, [application.executablePath]);
        return [application.id, null] as const;
      }
    }));
    return computerApplicationIconsSchema.parse(Object.fromEntries(icons));
  });
}
