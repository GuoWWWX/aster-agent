import { z } from "zod";

export { IPC_CHANNELS } from "./ipc-channels.js";
export type { IpcChannel } from "./ipc-channels.js";

import {
  approveToolChangeInputSchema,
  cancelRunInputSchema,
  conversationContextUsageInputSchema,
  conversationReferenceInputSchema,
  importConversationAttachmentBytesInputSchema,
  forkConversationInputSchema,
  pendingConversationMessageReferenceInputSchema,
  reorderPendingConversationMessagesInputSchema,
  removeConversationAttachmentInputSchema,
  createConversationInputSchema,
  discoverModelsInputSchema,
  ensureTeamMemberConversationInputSchema,
  getModelApiKeyInputSchema,
  testModelConnectionInputSchema,
  reorderConversationsInputSchema,
  renameConversationInputSchema,
  replaceLatestConversationMessageInputSchema,
  setConversationArchivedInputSchema,
  setConversationModelSelectionInputSchema,
  setConversationProjectInputSchema,
  setConversationPinnedInputSchema,
  saveModelConfigurationInputSchema,
  setDefaultModelInputSchema,
  setTeamCoordinatorInputSchema,
  sendConversationMessageInputSchema,
  sendTeamMessageInputSchema,
  updatePendingConversationMessageInputSchema
} from "./conversation.js";
import { setPluginEnabledInputSchema } from "./plugin.js";
import {
  createProjectEntryInputSchema,
  listProjectEntriesInputSchema,
  projectReferenceInputSchema,
  readProjectFileInputSchema,
  readProjectPreviewImageInputSchema,
  reorderProjectsInputSchema,
  renameProjectInputSchema,
  setProjectPinnedInputSchema,
  setProjectTeamsInNavigatorInputSchema,
  writeProjectFileInputSchema
} from "./project.js";
import { integrationConfigurationSchema } from "./integration.js";
import { browserConfigurationSchema } from "./browser.js";
import { terminalConfigurationSchema } from "./terminal.js";
import {
  gitFileDiffInputSchema,
  gitOperationInputSchema,
  gitReviewInputSchema,
  managedBrowserBoundsInputSchema,
  managedBrowserCommandInputSchema,
  managedBrowserNavigateInputSchema,
  managedBrowserOpenInputSchema,
  managedBrowserReferenceInputSchema,
  terminalSessionOpenInputSchema,
  terminalSessionOutputInputSchema,
  terminalSessionReferenceInputSchema,
  terminalSessionResizeInputSchema,
  terminalSessionWriteInputSchema,
  workspaceBrowserTabOpenedInputSchema,
  workspaceTerminalTabOpenedInputSchema,
} from "./developer-tools.js";
import { contextCompressionConfigurationSchema } from "./context-compression.js";
import { applicationSettingsSchema } from "./application-settings.js";
import {
  createConfigurationWorkspaceEntryInputSchema,
  deleteConfigurationWorkspaceEntryInputSchema,
  listConfigurationWorkspaceEntriesInputSchema,
  readConfigurationWorkspaceFileInputSchema,
  writeConfigurationWorkspaceFileInputSchema,
} from "./configuration-workspace.js";
import {
  createSkillDocumentInputSchema,
  skillDocumentReferenceInputSchema,
  skillDocumentSaveInputSchema,
} from "./skill-document.js";
import {
  acceptTeamWorkItemInputSchema,
  getTeamWorkItemExecutionInputSchema,
  listTeamWorkItemsInputSchema,
  requestTeamWorkItemReworkInputSchema,
  submitTeamWorkItemInputSchema,
  updateTeamWorkItemInputSchema,
  updateTeamWorkItemPermissionInputSchema,
} from "./team-work-item.js";
import { getTeamCollaborationProjectionInputSchema } from "./team-collaboration.js";
import {
  createTeamInstanceInputSchema,
  ensureTeamInstanceMemberConversationInputSchema,
  listTeamInstancesInputSchema,
  renameTeamInstanceInputSchema,
  reorderTeamInstancesInputSchema,
  setTeamInstanceArchivedInputSchema,
  teamInstanceReferenceInputSchema,
} from "./team-instance.js";

/**
 * Bootstrap IPC methods deliberately accept no renderer-supplied arguments.
 * Keep the schema shared so every host validates the same request boundary.
 */
export const emptyIpcArgumentsSchema = z.tuple([]);

export const listProjectEntriesIpcArgumentsSchema = z.tuple([
  listProjectEntriesInputSchema
]);

export const createProjectEntryIpcArgumentsSchema = z.tuple([
  createProjectEntryInputSchema
]);

export const readProjectFileIpcArgumentsSchema = z.tuple([
  readProjectFileInputSchema
]);

export const writeProjectFileIpcArgumentsSchema = z.tuple([
  writeProjectFileInputSchema
]);

export const readProjectPreviewImageIpcArgumentsSchema = z.tuple([
  readProjectPreviewImageInputSchema
]);

export const projectReferenceIpcArgumentsSchema = z.tuple([
  projectReferenceInputSchema
]);

export const renameProjectIpcArgumentsSchema = z.tuple([
  renameProjectInputSchema
]);

export const reorderProjectsIpcArgumentsSchema = z.tuple([
  reorderProjectsInputSchema
]);

export const setProjectPinnedIpcArgumentsSchema = z.tuple([
  setProjectPinnedInputSchema
]);

export const setProjectTeamsInNavigatorIpcArgumentsSchema = z.tuple([
  setProjectTeamsInNavigatorInputSchema
]);

export const createConversationIpcArgumentsSchema = z.tuple([
  createConversationInputSchema
]);

export const renameConversationIpcArgumentsSchema = z.tuple([
  renameConversationInputSchema
]);

export const reorderConversationsIpcArgumentsSchema = z.tuple([
  reorderConversationsInputSchema
]);

export const setConversationProjectIpcArgumentsSchema = z.tuple([
  setConversationProjectInputSchema
]);

export const setConversationModelSelectionIpcArgumentsSchema = z.tuple([
  setConversationModelSelectionInputSchema
]);

export const setConversationArchivedIpcArgumentsSchema = z.tuple([
  setConversationArchivedInputSchema
]);

export const setConversationPinnedIpcArgumentsSchema = z.tuple([
  setConversationPinnedInputSchema
]);

export const conversationReferenceIpcArgumentsSchema = z.tuple([
  conversationReferenceInputSchema
]);

export const forkConversationIpcArgumentsSchema = z.tuple([
  forkConversationInputSchema
]);

export const pendingConversationMessageReferenceIpcArgumentsSchema = z.tuple([
  pendingConversationMessageReferenceInputSchema
]);

export const updatePendingConversationMessageIpcArgumentsSchema = z.tuple([
  updatePendingConversationMessageInputSchema
]);

export const reorderPendingConversationMessagesIpcArgumentsSchema = z.tuple([
  reorderPendingConversationMessagesInputSchema
]);

export const conversationContextUsageIpcArgumentsSchema = z.tuple([
  conversationContextUsageInputSchema
]);

export const removeConversationAttachmentIpcArgumentsSchema = z.tuple([
  removeConversationAttachmentInputSchema
]);

export const importConversationAttachmentBytesIpcArgumentsSchema = z.tuple([
  importConversationAttachmentBytesInputSchema,
]);

export const sendConversationMessageIpcArgumentsSchema = z.tuple([
  sendConversationMessageInputSchema
]);

export const setTeamCoordinatorIpcArgumentsSchema = z.tuple([
  setTeamCoordinatorInputSchema,
]);

export const ensureTeamMemberConversationIpcArgumentsSchema = z.tuple([
  ensureTeamMemberConversationInputSchema,
]);

export const listTeamInstancesIpcArgumentsSchema = z.tuple([
  listTeamInstancesInputSchema,
]);

export const createTeamInstanceIpcArgumentsSchema = z.tuple([
  createTeamInstanceInputSchema,
]);

export const renameTeamInstanceIpcArgumentsSchema = z.tuple([
  renameTeamInstanceInputSchema,
]);

export const reorderTeamInstancesIpcArgumentsSchema = z.tuple([
  reorderTeamInstancesInputSchema,
]);

export const setTeamInstanceArchivedIpcArgumentsSchema = z.tuple([
  setTeamInstanceArchivedInputSchema,
]);

export const deleteTeamInstanceIpcArgumentsSchema = z.tuple([
  teamInstanceReferenceInputSchema,
]);

export const ensureTeamInstanceMemberConversationIpcArgumentsSchema = z.tuple([
  ensureTeamInstanceMemberConversationInputSchema,
]);

export const listTeamWorkItemsIpcArgumentsSchema = z.tuple([
  listTeamWorkItemsInputSchema,
]);

export const getTeamWorkItemExecutionIpcArgumentsSchema = z.tuple([
  getTeamWorkItemExecutionInputSchema,
]);

export const getTeamCollaborationProjectionIpcArgumentsSchema = z.tuple([
  getTeamCollaborationProjectionInputSchema,
]);

export const submitTeamWorkItemIpcArgumentsSchema = z.tuple([
  submitTeamWorkItemInputSchema,
]);

export const updateTeamWorkItemIpcArgumentsSchema = z.tuple([
  updateTeamWorkItemInputSchema,
]);

export const updateTeamWorkItemPermissionIpcArgumentsSchema = z.tuple([
  updateTeamWorkItemPermissionInputSchema,
]);

export const requestTeamWorkItemReworkIpcArgumentsSchema = z.tuple([
  requestTeamWorkItemReworkInputSchema,
]);

export const acceptTeamWorkItemIpcArgumentsSchema = z.tuple([
  acceptTeamWorkItemInputSchema,
]);

export const sendTeamMessageIpcArgumentsSchema = z.tuple([
  sendTeamMessageInputSchema,
]);

export const setPluginEnabledIpcArgumentsSchema = z.tuple([
  setPluginEnabledInputSchema,
]);

export const replaceLatestConversationMessageIpcArgumentsSchema = z.tuple([
  replaceLatestConversationMessageInputSchema
]);

export const cancelRunIpcArgumentsSchema = z.tuple([cancelRunInputSchema]);
export const approveToolChangeIpcArgumentsSchema = z.tuple([
  approveToolChangeInputSchema
]);

export const discoverModelsIpcArgumentsSchema = z.tuple([
  discoverModelsInputSchema
]);

export const getModelApiKeyIpcArgumentsSchema = z.tuple([
  getModelApiKeyInputSchema
]);

export const testModelConnectionIpcArgumentsSchema = z.tuple([
  testModelConnectionInputSchema
]);

export const saveModelConfigurationIpcArgumentsSchema = z.tuple([
  saveModelConfigurationInputSchema
]);

export const setDefaultModelIpcArgumentsSchema = z.tuple([
  setDefaultModelInputSchema
]);

export const contextCompressionConfigurationIpcArgumentsSchema = z.tuple([
  contextCompressionConfigurationSchema
]);

export const applicationSettingsIpcArgumentsSchema = z.tuple([
  applicationSettingsSchema,
]);

export const integrationConfigurationIpcArgumentsSchema = z.tuple([
  integrationConfigurationSchema
]);

export const terminalConfigurationIpcArgumentsSchema = z.tuple([
  terminalConfigurationSchema,
]);

export const browserConfigurationIpcArgumentsSchema = z.tuple([
  browserConfigurationSchema,
]);

export const gitReviewIpcArgumentsSchema = z.tuple([gitReviewInputSchema]);
export const gitFileDiffIpcArgumentsSchema = z.tuple([gitFileDiffInputSchema]);
export const gitOperationIpcArgumentsSchema = z.tuple([gitOperationInputSchema]);
export const terminalSessionOpenIpcArgumentsSchema = z.tuple([terminalSessionOpenInputSchema]);
export const terminalSessionOutputIpcArgumentsSchema = z.tuple([terminalSessionOutputInputSchema]);
export const terminalSessionWriteIpcArgumentsSchema = z.tuple([terminalSessionWriteInputSchema]);
export const terminalSessionResizeIpcArgumentsSchema = z.tuple([terminalSessionResizeInputSchema]);
export const terminalSessionReferenceIpcArgumentsSchema = z.tuple([
  terminalSessionReferenceInputSchema,
]);
export const workspaceTerminalTabOpenedIpcArgumentsSchema = z.tuple([
  workspaceTerminalTabOpenedInputSchema,
]);
export const workspaceBrowserTabOpenedIpcArgumentsSchema = z.tuple([
  workspaceBrowserTabOpenedInputSchema,
]);
export const managedBrowserOpenIpcArgumentsSchema = z.tuple([managedBrowserOpenInputSchema]);
export const managedBrowserNavigateIpcArgumentsSchema = z.tuple([
  managedBrowserNavigateInputSchema,
]);
export const managedBrowserCommandIpcArgumentsSchema = z.tuple([
  managedBrowserCommandInputSchema,
]);
export const managedBrowserBoundsIpcArgumentsSchema = z.tuple([
  managedBrowserBoundsInputSchema,
]);
export const managedBrowserReferenceIpcArgumentsSchema = z.tuple([
  managedBrowserReferenceInputSchema,
]);

export const skillDocumentReferenceIpcArgumentsSchema = z.tuple([
  skillDocumentReferenceInputSchema,
]);

export const skillDocumentSaveIpcArgumentsSchema = z.tuple([
  skillDocumentSaveInputSchema,
]);

export const createSkillDocumentIpcArgumentsSchema = z.tuple([
  createSkillDocumentInputSchema.optional(),
]);

export const listConfigurationWorkspaceEntriesIpcArgumentsSchema = z.tuple([
  listConfigurationWorkspaceEntriesInputSchema,
]);

export const readConfigurationWorkspaceFileIpcArgumentsSchema = z.tuple([
  readConfigurationWorkspaceFileInputSchema,
]);

export const createConfigurationWorkspaceEntryIpcArgumentsSchema = z.tuple([
  createConfigurationWorkspaceEntryInputSchema,
]);

export const writeConfigurationWorkspaceFileIpcArgumentsSchema = z.tuple([
  writeConfigurationWorkspaceFileInputSchema,
]);

export const deleteConfigurationWorkspaceEntryIpcArgumentsSchema = z.tuple([
  deleteConfigurationWorkspaceEntryInputSchema,
]);

const MAX_CLIPBOARD_TEXT_LENGTH = 2_000_000;

export const clipboardWriteTextIpcArgumentsSchema = z.tuple([
  z.string().max(MAX_CLIPBOARD_TEXT_LENGTH),
]);

export const voidIpcResponseSchema = z.void();
