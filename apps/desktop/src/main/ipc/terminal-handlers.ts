import {
  IPC_CHANNELS,
  terminalConfigurationIpcArgumentsSchema,
  terminalConfigurationSchema,
  terminalSessionOpenIpcArgumentsSchema,
  terminalSessionOutputIpcArgumentsSchema,
  terminalSessionOutputSchema,
  terminalSessionReferenceIpcArgumentsSchema,
  terminalSessionResizeIpcArgumentsSchema,
  terminalSessionSchema,
  terminalSessionWriteIpcArgumentsSchema,
  workspaceTerminalTabOpenedIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerTerminalSettingsHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { terminalConfiguration }: Pick<MainIpcDependencies, "terminalConfiguration">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.terminalGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return terminalConfigurationSchema.parse(
        terminalConfiguration.getConfiguration(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = terminalConfigurationIpcArgumentsSchema.parse(args);
      return terminalConfigurationSchema.parse(
        terminalConfiguration.saveConfiguration(input),
      );
    },
  );
}

export function registerTerminalSessionHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { terminalSessions, workspaceTerminalTabs }: Pick<MainIpcDependencies, "terminalSessions" | "workspaceTerminalTabs">,
): void {
  ipcMain.handle(IPC_CHANNELS.terminalSessionOpen, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionOpenIpcArgumentsSchema.parse(args);
    return terminalSessionSchema.parse(terminalSessions.open(input));
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionReadOutput, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionOutputIpcArgumentsSchema.parse(args);
    return terminalSessionOutputSchema.parse(terminalSessions.readOutput(input));
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionWrite, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionWriteIpcArgumentsSchema.parse(args);
    terminalSessions.write(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionResize, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionResizeIpcArgumentsSchema.parse(args);
    terminalSessions.resize(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionClose, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionReferenceIpcArgumentsSchema.parse(args);
    terminalSessions.close(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceTerminalOpened, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = workspaceTerminalTabOpenedIpcArgumentsSchema.parse(args);
    workspaceTerminalTabs.confirmOpened(input);
    return voidIpcResponseSchema.parse(undefined);
  });
}
