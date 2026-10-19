import { dialog } from "electron";
import {
  createSkillDocumentIpcArgumentsSchema,
  IPC_CHANNELS,
  skillDocumentReferenceIpcArgumentsSchema,
  skillDocumentSaveIpcArgumentsSchema,
  skillDiscoveryResultSchema,
  skillDocumentSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerSkillDocumentHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { skillDocuments }: Pick<MainIpcDependencies, "skillDocuments">,
): void {
  ipcMain.handle(IPC_CHANNELS.skillCreateDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = createSkillDocumentIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.createManagedDocument(input));
  });

  ipcMain.handle(IPC_CHANNELS.skillDiscoverDocuments, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return skillDiscoveryResultSchema.parse(skillDocuments.discoverDocuments());
  });

  ipcMain.handle(IPC_CHANNELS.skillChooseDirectory, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "选择 Skill 目录",
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return skillDiscoveryResultSchema.parse(skillDocuments.chooseDirectory(selectedPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillImportDocument, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    const selection = await dialog.showOpenDialog(window, {
      filters: [{ name: "Skill 文档", extensions: ["md"] }],
      properties: ["openFile"],
      title: "导入 SKILL.md",
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return skillDocumentSchema.parse(skillDocuments.importDocument(selectedPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillDeleteDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = skillDocumentReferenceIpcArgumentsSchema.parse(args);
    skillDocuments.deleteDocument(input.entryPath);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.skillReadDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = skillDocumentReferenceIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.readDocument(input.entryPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillSaveDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = skillDocumentSaveIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.saveDocument(input));
  });
}
