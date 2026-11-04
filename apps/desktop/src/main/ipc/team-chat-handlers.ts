import { teamInstanceReferenceInputSchema } from "@agent/protocol";
import {
  markTeamChatReadInputSchema,
  postTeamChatInputSchema,
  readTeamChatInputSchema,
  teamChatCoordinationConversationInputSchema,
  taskContextReferenceSchema,
  teamChatMessageSchema,
  teamChatPageSchema,
  teamChatMemberSchema,
} from "@agent/protocol";
import { z } from "zod";
import { conversationSummarySchema, IPC_CHANNELS } from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerTeamChatHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { agentRuntime, database }: Pick<MainIpcDependencies, "agentRuntime" | "database">,
  emitConversationRunEvent: (event: unknown) => void,
): void {
  ipcMain.handle(IPC_CHANNELS.teamChatRead, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([readTeamChatInputSchema]).parse(args);
    const result = teamChatPageSchema.parse(database.collaboration.readMessages(input));
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatPost, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([postTeamChatInputSchema]).parse(args);
    const result = teamChatMessageSchema.parse(agentRuntime.postTeamChat(input, emitConversationRunEvent));
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatCoordinationConversation, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([teamChatCoordinationConversationInputSchema]).parse(args);
    return conversationSummarySchema.parse(agentRuntime.getTeamChatCoordinationConversation(input));
  });
  ipcMain.handle(IPC_CHANNELS.teamChatMembers, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([teamInstanceReferenceInputSchema]).parse(args);
    const result = z.array(teamChatMemberSchema).parse(database.collaboration.members(input.teamInstanceId));
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatMarkRead, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([markTeamChatReadInputSchema]).parse(args);
    const instance = database.getTeamInstance(input.teamInstanceId);
    const changed = database.collaboration.markRead(input, null);
    if (changed && instance.rootConversationId !== null) emitConversationRunEvent({
      type: "collaboration.changed", conversationId: instance.rootConversationId, teamInstanceId: instance.id, reason: "read",
    });
    return undefined;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatResume, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([taskContextReferenceSchema]).parse(args);
    agentRuntime.resumeTeamChatDelivery(input.id, emitConversationRunEvent);
    return null;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatCancel, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([taskContextReferenceSchema]).parse(args);
    const result = database.collaboration.cancelDelivery(input.id);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.teamChatPause, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([teamInstanceReferenceInputSchema]).parse(args);
    await agentRuntime.pauseTeamChat(input.teamInstanceId, emitConversationRunEvent);
    return null;
  });
}
