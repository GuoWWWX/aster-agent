import {
  acceptTeamWorkItemIpcArgumentsSchema,
  getTeamWorkItemExecutionIpcArgumentsSchema,
  getTeamCollaborationProjectionIpcArgumentsSchema,
  IPC_CHANNELS,
  listTeamWorkItemsIpcArgumentsSchema,
  publishTeamWorkItemIpcArgumentsSchema,
  addTeamWorkItemCommentIpcArgumentsSchema,
  requestTeamWorkItemReworkIpcArgumentsSchema,
  teamWorkItemExecutionViewSchema,
  teamCollaborationProjectionSchema,
  teamWorkItemListSchema,
  teamWorkItemViewSchema,
  submitTeamWorkItemIpcArgumentsSchema,
  deleteTeamWorkItemIpcArgumentsSchema,
  updateTeamWorkItemIpcArgumentsSchema,
  updateTeamWorkItemPermissionIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerTeamWorkItemHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { teamWorkItems }: Pick<MainIpcDependencies, "teamWorkItems">,
  emitConversationRunEvent: (event: unknown) => void,
): void {
  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listTeamWorkItemsIpcArgumentsSchema.parse(args);
      return teamWorkItemListSchema.parse(teamWorkItems.list(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemGetExecution,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = getTeamWorkItemExecutionIpcArgumentsSchema.parse(args);
      return teamWorkItemExecutionViewSchema.parse(teamWorkItems.getExecution(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamCollaborationGetProjection,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = getTeamCollaborationProjectionIpcArgumentsSchema.parse(args);
      return teamCollaborationProjectionSchema.parse(
        teamWorkItems.getCollaborationProjection(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemSubmit,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = submitTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.submit(input, (runEvent) =>
          emitConversationRunEvent(runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemUpdate,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = updateTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.update(input, (runEvent) =>
          emitConversationRunEvent(runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemDelete,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteTeamWorkItemIpcArgumentsSchema.parse(args);
      teamWorkItems.delete(input, (runEvent) =>
        emitConversationRunEvent(runEvent));
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemUpdatePermission,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = updateTeamWorkItemPermissionIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.updatePermission(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemPublish,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = publishTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.publish(input, (runEvent) =>
          emitConversationRunEvent(runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemRequestRework,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = requestTeamWorkItemReworkIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.requestRework(input, (runEvent) =>
          emitConversationRunEvent(runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemAddComment,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = addTeamWorkItemCommentIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.addComment(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemAccept,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = acceptTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.accept(input));
    },
  );
}
