import { dialog } from "electron";
import {
  conversationAttachmentListSchema,
  conversationAttachmentPreviewSchema,
  importConversationAttachmentBytesIpcArgumentsSchema,
  conversationReferenceIpcArgumentsSchema,
  IPC_CHANNELS,
  readConversationAttachmentPreviewIpcArgumentsSchema,
  removeConversationAttachmentIpcArgumentsSchema,
  voidIpcResponseSchema,
} from "@agent/protocol";
import { getTrustedWindow, type IpcHandlerRegistrationContext } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerAttachmentHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { attachments }: Pick<MainIpcDependencies, "attachments">,
): void {
  ipcMain.handle(
    IPC_CHANNELS.conversationChooseAttachments,
    async (event, ...args: unknown[]) => {
      const window = getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        title: "添加文件或图片"
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return conversationAttachmentListSchema.parse(
          attachments.listDrafts(input.conversationId)
        );
      }
      await attachments.importFiles(input.conversationId, selection.filePaths);
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationImportAttachmentBytes,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = importConversationAttachmentBytesIpcArgumentsSchema.parse(args);
      await attachments.importBytes(input.conversationId, {
        bytes: Buffer.from(input.base64, "base64"),
        name: input.name,
        ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      });
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationReadAttachmentPreview,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readConversationAttachmentPreviewIpcArgumentsSchema.parse(args);
      return conversationAttachmentPreviewSchema.parse(
        attachments.readImagePreview(input.conversationId, input.attachmentId),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationListDraftAttachments,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationRemoveAttachment,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = removeConversationAttachmentIpcArgumentsSchema.parse(args);
      await attachments.removeDraft(input.conversationId, input.attachmentId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );
}
