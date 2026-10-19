import {
  conversationMessageSubmissionSchema,
  createTeamInstanceIpcArgumentsSchema,
  ensureTeamMemberConversationIpcArgumentsSchema,
  ensureTeamInstanceMemberConversationIpcArgumentsSchema,
  IPC_CHANNELS,
  listTeamInstancesIpcArgumentsSchema,
  reorderTeamInstancesIpcArgumentsSchema,
  renameTeamInstanceIpcArgumentsSchema,
  sendTeamMessageIpcArgumentsSchema,
  setTeamCoordinatorIpcArgumentsSchema,
  setTeamInstanceArchivedIpcArgumentsSchema,
  teamMemberConversationViewSchema,
  teamInstanceListSchema,
  teamInstanceViewSchema,
  deleteTeamInstanceIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerTeamHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { agentRuntime, database, teamWorkItems }: Pick<MainIpcDependencies, "agentRuntime" | "database" | "teamWorkItems">,
  emitConversationRunEvent: (event: unknown) => void,
): void {
  ipcMain.handle(
    IPC_CHANNELS.teamSetCoordinator,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setTeamCoordinatorIpcArgumentsSchema.parse(args);
      database.setTeamCoordinatorConversation(input.teamId, input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamEnsureMemberConversation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = ensureTeamMemberConversationIpcArgumentsSchema.parse(args);
      return teamMemberConversationViewSchema.parse(
        teamWorkItems.ensureSharedMemberConversation(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listTeamInstancesIpcArgumentsSchema.parse(args);
      return teamInstanceListSchema.parse(
        database.listTeamInstances(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceCreate,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createTeamInstanceIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.createInstance(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceRename,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = renameTeamInstanceIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.renameInstance(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceReorder,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = reorderTeamInstancesIpcArgumentsSchema.parse(args);
      return teamInstanceListSchema.parse(
        database.reorderTeamInstances(input.teamInstanceIds),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceSetArchived,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setTeamInstanceArchivedIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.setInstanceArchived(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceDelete,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteTeamInstanceIpcArgumentsSchema.parse(args);
      teamWorkItems.deleteInstance(input.teamInstanceId);
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceEnsureMemberConversation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = ensureTeamInstanceMemberConversationIpcArgumentsSchema.parse(args);
      return teamMemberConversationViewSchema.parse(
        teamWorkItems.ensureInstanceMemberConversation(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamSendMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = sendTeamMessageIpcArgumentsSchema.parse(args);
      const { teamId, ...conversationInput } = input;
      const coordinatorConversationId = database.getTeamCoordinatorConversationId(teamId);
      if (coordinatorConversationId === null) {
        throw new Error("Team has no coordinator Conversation. Create and bind a Team Lead conversation first.");
      }
      return conversationMessageSubmissionSchema.parse(
        agentRuntime.sendMessage({
          ...conversationInput,
          conversationId: coordinatorConversationId,
        }, (runEvent) => emitConversationRunEvent(runEvent)),
      );
    },
  );
}
