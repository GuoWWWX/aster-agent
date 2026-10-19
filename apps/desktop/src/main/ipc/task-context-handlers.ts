import {
  taskContextScopeSchema,
  taskCompletionPolicySchema,
  setTaskCompletionPolicyInputSchema,
  resolveChatReferencesInputSchema,
  chatReferencesSchema,
} from "@agent/protocol";
import {
  getTaskContextInputSchema,
  linkTaskContextInputSchema,
  listTaskContextsInputSchema,
  mergeTaskContextsInputSchema,
  taskContextDetailSchema,
  taskContextPageSchema,
  taskContextSchema,
  updateTaskContextInputSchema,
} from "@agent/protocol";
import { z } from "zod";
import { IPC_CHANNELS } from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerTaskContextHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { database }: Pick<MainIpcDependencies, "database">,
  emitConversationRunEvent: (event: unknown) => void,
): void {
  ipcMain.handle(IPC_CHANNELS.taskCompletionPolicyGet, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([taskContextScopeSchema]).parse(args);
    return taskCompletionPolicySchema.parse(database.collaboration.getCompletionPolicy(input));
  });
  ipcMain.handle(IPC_CHANNELS.taskCompletionPolicySet, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([setTaskCompletionPolicyInputSchema]).parse(args);
    return taskCompletionPolicySchema.parse(database.collaboration.setCompletionPolicy(input));
  });
  ipcMain.handle(IPC_CHANNELS.chatReferencesResolve, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([resolveChatReferencesInputSchema]).parse(args);
    return chatReferencesSchema.parse(database.collaboration.resolveReferences(input));
  });
  ipcMain.handle(IPC_CHANNELS.taskContextList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    database.collaboration.syncWorkItems(database.listTeamWorkItems({}));
    const [input] = z.tuple([listTaskContextsInputSchema]).parse(args);
    const result = taskContextPageSchema.parse(database.collaboration.listTasks(input));
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.taskContextGet, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    database.collaboration.syncWorkItems(database.listTeamWorkItems({}));
    const [input] = z.tuple([getTaskContextInputSchema]).parse(args);
    const result = taskContextDetailSchema.parse(database.collaboration.getTask(input.id, input));
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.taskContextUpdate, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([updateTaskContextInputSchema]).parse(args);
    const result = taskContextSchema.parse(database.collaboration.updateTask(input));
    emitConversationRunEvent({ type: "collaboration.changed", conversationId: input.conversationId,
      ...(result.teamInstanceId === null ? {} : { teamInstanceId: result.teamInstanceId }) });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.taskContextLink, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([linkTaskContextInputSchema]).parse(args);
    const result = database.collaboration.linkTask(input);
    const task = database.collaboration.getTask(input.id).task;
    emitConversationRunEvent({ type: "collaboration.changed", conversationId: task.ownerConversationId,
      ...(task.teamInstanceId === null ? {} : { teamInstanceId: task.teamInstanceId }) });
    if (input.source.kind === "conversation" && input.source.containerId !== task.ownerConversationId)
      emitConversationRunEvent({ type: "collaboration.changed", conversationId: input.source.containerId });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.taskContextMerge, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([mergeTaskContextsInputSchema]).parse(args);
    const result = taskContextSchema.parse(database.collaboration.mergeTasks(input));
    emitConversationRunEvent({ type: "collaboration.changed", conversationId: result.ownerConversationId,
      ...(result.teamInstanceId === null ? {} : { teamInstanceId: result.teamInstanceId }) });
    return result;
  });
}
