import { dialog } from "electron";
import {
  addProjectResponseSchema,
  createProjectEntryIpcArgumentsSchema,
  IPC_CHANNELS,
  listProjectEntriesIpcArgumentsSchema,
  projectDirectoryListingSchema,
  projectEntrySchema,
  projectFileSchema,
  projectListResponseSchema,
  projectPreviewImageSchema,
  projectReferenceIpcArgumentsSchema,
  projectSummarySchema,
  readProjectFileIpcArgumentsSchema,
  readProjectPreviewImageIpcArgumentsSchema,
  reorderProjectsIpcArgumentsSchema,
  renameProjectIpcArgumentsSchema,
  setProjectPinnedIpcArgumentsSchema,
  setProjectTeamsInNavigatorIpcArgumentsSchema,
  writeProjectFileIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerProjectHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { projectRegistry, tools }: Pick<MainIpcDependencies, "projectRegistry" | "tools">,
): void {
  ipcMain.handle(IPC_CHANNELS.projectList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return projectListResponseSchema.parse(projectRegistry.listProjects());
  });

  ipcMain.handle(IPC_CHANNELS.projectAdd, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);

    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "添加项目"
    });
    const selectedDirectory = selection.filePaths[0];

    if (selection.canceled || selectedDirectory === undefined) {
      return addProjectResponseSchema.parse(null);
    }

    return addProjectResponseSchema.parse(
      await projectRegistry.registerDirectory(selectedDirectory)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectRename, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = renameProjectIpcArgumentsSchema.parse(args);
    return projectSummarySchema.parse(
      projectRegistry.renameProject(input.projectId, input.name)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectReorder, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = reorderProjectsIpcArgumentsSchema.parse(args);
    return projectListResponseSchema.parse(
      projectRegistry.reorderProjects(input.projectIds)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectSetPinned, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setProjectPinnedIpcArgumentsSchema.parse(args);
    return projectSummarySchema.parse(
      projectRegistry.setProjectPinned(input.projectId, input.pinned)
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.projectSetTeamsInNavigator,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setProjectTeamsInNavigatorIpcArgumentsSchema.parse(args);
      return projectSummarySchema.parse(
        projectRegistry.setProjectTeamsInNavigator(
          input.projectId,
          input.showTeamsInNavigator
        )
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.projectRemove, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = projectReferenceIpcArgumentsSchema.parse(args);
    projectRegistry.removeProject(input.projectId);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(
    IPC_CHANNELS.projectListEntries,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listProjectEntriesIpcArgumentsSchema.parse(args);

      return projectDirectoryListingSchema.parse(
        await projectRegistry.listEntries(input)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectReadFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readProjectFileIpcArgumentsSchema.parse(args);
      return projectFileSchema.parse(await projectRegistry.readFile(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectWriteFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = writeProjectFileIpcArgumentsSchema.parse(args);
      return projectFileSchema.parse(
        await tools.writeUserFile(input, new AbortController().signal)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectReadPreviewImage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readProjectPreviewImageIpcArgumentsSchema.parse(args);
      return projectPreviewImageSchema.parse(await projectRegistry.readPreviewImage(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectCreateEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createProjectEntryIpcArgumentsSchema.parse(args);
      return projectEntrySchema.parse(await projectRegistry.createEntry(input));
    }
  );
}
