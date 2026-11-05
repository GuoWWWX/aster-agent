import { createProviderAccountService } from "../model/provider-account-service.js";
import { providerAccountRequestSchema } from "@agent/protocol";
import { z } from "zod";
import {
  discoverModelsIpcArgumentsSchema,
  chatGptConnectionListSchema,
  chatGptConnectInputSchema,
  chatGptConnectResultSchema,
  chatGptProviderInputSchema,
  discoveredModelSchema,
  getModelApiKeyIpcArgumentsSchema,
  deleteModelProviderIpcArgumentsSchema,
  IPC_CHANNELS,
  modelCatalogSchema,
  modelConnectionTestResultSchema,
  modelRuntimeStatusSchema,
  modelApiKeySchema,
  saveModelConfigurationIpcArgumentsSchema,
  testModelConnectionIpcArgumentsSchema,
  setDefaultModelIpcArgumentsSchema,
} from "@agent/protocol";
import {
  getTrustedWindow,
  parseNoArguments,
  type IpcHandlerRegistrationContext,
} from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

export function registerModelHandlers(
  { ipcMain, getMainWindow }: IpcHandlerRegistrationContext,
  { credentials, modelCatalog }: Pick<MainIpcDependencies, "credentials" | "modelCatalog">,
): void {
  const accounts = createProviderAccountService(credentials, () => modelCatalog.getCatalog());
  ipcMain.handle(IPC_CHANNELS.modelProviderAccounts, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== window.webContents.mainFrame) throw new Error("Rejected account request from an untrusted frame.");
    const [request] = z.tuple([providerAccountRequestSchema]).parse(args);
    return accounts.execute(request);
  });

  ipcMain.handle(IPC_CHANNELS.modelChatGptList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return chatGptConnectionListSchema.parse(credentials.listChatGptConnections());
  });

  ipcMain.handle(IPC_CHANNELS.modelChatGptConnect, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([chatGptConnectInputSchema]).parse(args);
    return chatGptConnectResultSchema.parse(await credentials.connectChatGpt(input.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.modelChatGptDisconnect, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([chatGptProviderInputSchema]).parse(args);
    return z.boolean().parse(await credentials.disconnectChatGpt(input.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.modelChatGptSync, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([chatGptProviderInputSchema]).parse(args);
    return modelRuntimeStatusSchema.parse(await credentials.syncChatGptModels(input.providerId, modelCatalog.getCatalog()));
  });

  ipcMain.handle(IPC_CHANNELS.modelGetStatus, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return modelRuntimeStatusSchema.parse(credentials.getStatus());
  });

  ipcMain.handle(IPC_CHANNELS.modelGetCatalog, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return modelCatalogSchema.parse(modelCatalog.getCatalog());
  });

  ipcMain.handle(IPC_CHANNELS.modelSaveCatalog, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [catalog] = z.tuple([modelCatalogSchema]).parse(args);
    return modelCatalogSchema.parse(modelCatalog.saveCatalog(catalog));
  });

  ipcMain.handle(IPC_CHANNELS.modelGetApiKey, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = getModelApiKeyIpcArgumentsSchema.parse(args);
    return modelApiKeySchema.parse(credentials.getApiKey(input.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.modelDeleteProvider, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = deleteModelProviderIpcArgumentsSchema.parse(args);
    return modelRuntimeStatusSchema.parse(credentials.deleteProvider(input.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.modelDiscover, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = discoverModelsIpcArgumentsSchema.parse(args);
    return discoveredModelSchema.array().parse(
      await credentials.discoverModels(input)
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelTestConnection, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = testModelConnectionIpcArgumentsSchema.parse(args);
    return modelConnectionTestResultSchema.parse(
      await credentials.testModelConnection(input.providerId, input.modelId)
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.modelSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = saveModelConfigurationIpcArgumentsSchema.parse(args);
      return modelRuntimeStatusSchema.parse(credentials.saveConfiguration(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.modelSetDefault,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setDefaultModelIpcArgumentsSchema.parse(args);
      return modelRuntimeStatusSchema.parse(credentials.setDefaultModel(input));
    }
  );
}
