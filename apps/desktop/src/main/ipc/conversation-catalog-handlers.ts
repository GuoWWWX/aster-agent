import { dialog } from "electron";
import { publishConversationAttentionEvent } from "../windows/conversation-attention.js";
import {
  conversationContextUsageIpcArgumentsSchema,
  conversationContextUsageSchema,
  conversationListResponseSchema,
  conversationReferenceIpcArgumentsSchema,
  conversationSearchIpcArgumentsSchema,
  conversationSearchResponseSchema,
  forkConversationIpcArgumentsSchema,
  conversationSummarySchema,
  conversationTaskListResponseSchema,
  conversationTimelineResponseSchema,
  conversationWorkspaceSelectionResponseSchema,
  createConversationIpcArgumentsSchema,
  IPC_CHANNELS,
  reorderConversationsIpcArgumentsSchema,
  renameConversationIpcArgumentsSchema,
  setConversationArchivedIpcArgumentsSchema,
  setConversationModelSelectionIpcArgumentsSchema,
  setConversationPermissionModeIpcArgumentsSchema,
  setConversationProjectIpcArgumentsSchema,
  setConversationPinnedIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerConversationCatalogHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { agentRuntime, conversationDeletion, conversationLifecycle, credentials, database, eventProjector, projectRegistry, threadLogLegacyImporter, teamWorkItems }: Pick<MainIpcDependencies, "agentRuntime" | "conversationDeletion" | "conversationLifecycle" | "credentials" | "database" | "eventProjector" | "projectRegistry" | "threadLogLegacyImporter" | "teamWorkItems">,
  emitConversationRunEvent: (event: unknown) => void,
): void {
  ipcMain.handle(IPC_CHANNELS.conversationList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return conversationListResponseSchema.parse(database.listConversations());
  });

  ipcMain.handle(IPC_CHANNELS.conversationListHierarchy, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return conversationListResponseSchema.parse(database.listConversationHierarchy());
  });

  ipcMain.handle(IPC_CHANNELS.conversationCreate, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = createConversationIpcArgumentsSchema.parse(args);
    const modelSelection = input.modelSelection === undefined
      ? undefined
      : credentials.resolveSelection(input.modelSelection);
    const conversation = conversationSummarySchema.parse(
      conversationLifecycle.createConversation(input.projectId ?? null, {
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(modelSelection === undefined ? {} : { modelSelection }),
        ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
        ...(input.threadKind === undefined ? {} : { threadKind: input.threadKind })
      })
    );
    emitConversationRunEvent({ type: "conversation.updated", conversation });
    return conversation;
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationSelectWorkspace,
    async (event, ...args: unknown[]) => {
      const window = getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const conversation = database.getConversation(input.conversationId);
      if (conversation.projectId !== null) {
        throw new Error("Project conversations already use their project root.");
      }
      if (conversation.activeRunId !== null) {
        throw new Error("A running conversation cannot change its workspace.");
      }
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "添加对话工作目录"
      });
      const selectedDirectory = selection.filePaths[0];
      if (selection.canceled || selectedDirectory === undefined) {
        return conversationWorkspaceSelectionResponseSchema.parse(null);
      }
      const workspace = await projectRegistry.mountConversationWorkspace(
        conversation.id,
        selectedDirectory
      );
      return conversationWorkspaceSelectionResponseSchema.parse(
        conversationLifecycle.setConversationWorkspaceRoot(conversation.id, workspace.rootPath)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationClearWorkspace,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const conversation = conversationLifecycle.setConversationWorkspaceRoot(
        input.conversationId,
        null
      );
      projectRegistry.unmountConversationWorkspace(input.conversationId);
      return conversationSummarySchema.parse(conversation);
    }
  );

  ipcMain.handle(IPC_CHANNELS.conversationFork, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = forkConversationIpcArgumentsSchema.parse(args);
    eventProjector.ensureConversationHistoryProjected(input.conversationId);
    const conversation = database.forkConversation(
      input.conversationId,
      input.throughMessageId === undefined ? "side" : "sibling",
      input.throughMessageId,
    );
    threadLogLegacyImporter.importConversationIfMissing(conversation.id);
    if (conversation.workspaceRootPath !== null) {
      projectRegistry.inheritConversationWorkspace(
        input.conversationId,
        conversation.id
      );
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationListForks, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    return conversationListResponseSchema.parse(
      database.listConversationForks(input.conversationId)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationRename, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = renameConversationIpcArgumentsSchema.parse(args);
    return conversationSummarySchema.parse(
      conversationLifecycle.renameConversation(input.conversationId, input.title)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationReorder, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = reorderConversationsIpcArgumentsSchema.parse(args);
    conversationLifecycle.reorderConversations(input.conversationIds);
    return conversationListResponseSchema.parse(database.listConversations());
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetProject, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationProjectIpcArgumentsSchema.parse(args);
    const conversation = conversationLifecycle.setConversationProject(
      input.conversationId,
      input.projectId
    );
    if (input.projectId !== null) {
      projectRegistry.unmountConversationWorkspace(input.conversationId);
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetModelSelection, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationModelSelectionIpcArgumentsSchema.parse(args);
    const selection = credentials.resolveSelection(input.modelSelection);
    const current = database.getConversation(input.conversationId);
    const conversation = current.teamWorkItemId === null
      ? conversationLifecycle.setConversationModelSelection(input.conversationId, selection)
      : teamWorkItems.updateModelSelection(input.conversationId, selection);
    if (current.threadKind !== "subagent" && current.teamWorkItemId === null) {
      credentials.setRecentSelection(selection);
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetPermissionMode, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationPermissionModeIpcArgumentsSchema.parse(args);
    return conversationSummarySchema.parse(
      conversationLifecycle.setConversationPermissionMode(
        input.conversationId,
        input.permissionMode,
        input.coordinationMode,
      ),
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetArchived, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationArchivedIpcArgumentsSchema.parse(args);
    const conversation = conversationSummarySchema.parse(
      conversationLifecycle.setConversationArchived(input.conversationId, input.archived)
    );
    emitConversationRunEvent({
      conversation,
      type: "conversation.updated"
    });
    return conversation;
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetPinned, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationPinnedIpcArgumentsSchema.parse(args);
    return conversationSummarySchema.parse(
      conversationLifecycle.setConversationPinned(input.conversationId, input.pinned)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationDelete, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    await conversationDeletion.requestDeletion(input.conversationId);
    publishConversationAttentionEvent();
    return voidIpcResponseSchema.parse(undefined);
  });
  ipcMain.handle(IPC_CHANNELS.conversationDeleteUndoable, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    conversationDeletion.requestUndoableDeletion(input.conversationId);
    publishConversationAttentionEvent();
    return voidIpcResponseSchema.parse(undefined);
  });
  ipcMain.handle(IPC_CHANNELS.conversationRestoreDeleted, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    conversationDeletion.restoreDeletedConversation(input.conversationId);
    publishConversationAttentionEvent();
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationListTimeline,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      await eventProjector.prepareTimeline(input.conversationId);
      return conversationTimelineResponseSchema.parse(
        eventProjector.listTimeline(input.conversationId)
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.conversationSearch, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationSearchIpcArgumentsSchema.parse(args);
    return conversationSearchResponseSchema.parse(await eventProjector.searchConversations(input));
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationGetTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationTaskListResponseSchema.parse(
        database.getTaskList(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationCloseTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      database.closeTaskList(input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationDeleteTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      database.deleteTaskList(input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationMarkResultViewed,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const conversation = conversationSummarySchema.parse(
        conversationLifecycle.markConversationResultViewed(input.conversationId)
      );
      emitConversationRunEvent({
        conversation,
        type: "conversation.updated"
      });
      return conversation;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationGetContextUsage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationContextUsageIpcArgumentsSchema.parse(args);
      return conversationContextUsageSchema.parse(
        agentRuntime.getContextUsage(input)
      );
    }
  );
}
