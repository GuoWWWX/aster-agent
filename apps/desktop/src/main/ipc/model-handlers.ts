import { z } from "zod";
import {
  discoverModelsIpcArgumentsSchema,
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
