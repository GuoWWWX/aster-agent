import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  contextCompressionThresholdSchema,
  isReasoningOptionSupportedByApiFormat,
  modelApiFormatSchema,
  modelConnectionStatusSchema,
  modelProviderIconSchema,
  modelReasoningOptionSchema,
  modelRuntimeStatusSchema,
  type DiscoverModelsInput,
  type DiscoveredModel,
  type ModelApiFormat,
  type ModelConnectionStatus,
  type ModelProfile,
  type ModelReasoningOption,
  type ModelRuntimeStatus,
  type SaveModelConfigurationInput,
  type SetDefaultModelInput
} from "@agent/protocol";
import { z } from "zod";

import {
  readJsonDocument,
  writeJsonDocument,
} from "../settings/json-configuration-file.js";
import { ModelAdapterRegistry } from "./model-adapter-registry.js";
import type { ModelConfiguration } from "./model-contracts.js";
import { ModelResponseError } from "./model-request-error.js";

export type { ModelConfiguration } from "./model-contracts.js";

const storedModelBaseSchema = z
  .object({
    contextCompression: contextCompressionThresholdSchema.optional(),
    contextWindow: z.number().int().min(0).max(10_000_000),
    displayName: z.string().min(1).max(200).optional(),
    modelId: z.string().min(1).max(200)
  });

const legacyStoredModelSchema = storedModelBaseSchema.extend({
  configuredReasoningEffort: z
    .enum(["low", "medium", "high", "xhigh"])
    .nullable()
    .optional()
}).strict();

const storedModelSchema = storedModelBaseSchema.extend({
  connectionStatus: modelConnectionStatusSchema.optional(),
  reasoningOptions: z.array(modelReasoningOptionSchema).max(16)
}).strict();

const LEGACY_PROVIDER_ID = "00000000-0000-4000-8000-000000000001";

const storedProviderV3Schema = z
  .object({
    baseUrl: z.string().url(),
    encryptedApiKey: z.string().min(1),
    id: z.string().uuid(),
    models: z.array(legacyStoredModelSchema).min(1).max(100),
    name: z.string().min(1).max(100)
  })
  .strict();

const storedProviderV4Schema = storedProviderV3Schema.extend({
  apiFormat: modelApiFormatSchema
});

const storedProviderSchema = z.object({
  apiFormat: modelApiFormatSchema,
  baseUrl: z.string().url(),
  encryptedApiKey: z.string().min(1),
  id: z.string().uuid(),
  icon: modelProviderIconSchema.optional(),
  models: z.array(storedModelSchema).min(1).max(100),
  name: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional()
}).strict();

const storedConfigurationV1Schema = z
  .object({
    baseUrl: z.string().url(),
    encryptedApiKey: z.string().min(1),
    modelId: z.string().min(1).max(200),
    version: z.literal(1)
  })
  .strict();

const storedConfigurationV2Schema = z
  .object({
    baseUrl: z.string().url(),
    defaultModelId: z.string().min(1).max(200),
    encryptedApiKey: z.string().min(1),
    models: z.array(legacyStoredModelSchema).min(1).max(100),
    version: z.literal(2)
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.models.some((model) => model.modelId === value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        message: "The default model must be configured.",
        path: ["defaultModelId"]
      });
    }
  });

const storedConfigurationV3Schema = z
  .object({
    defaultModelId: z.string().min(1).max(200),
    defaultProviderId: z.string().uuid(),
    providers: z.array(storedProviderV3Schema).min(1).max(100),
    version: z.literal(3)
  })
  .strict()
  .superRefine((value, context) => {
    const defaultProvider = value.providers.find(
      (provider) => provider.id === value.defaultProviderId
    );
    if (defaultProvider === undefined) {
      context.addIssue({
        code: "custom",
        message: "The default provider must be configured.",
        path: ["defaultProviderId"]
      });
      return;
    }
    if (!defaultProvider.models.some((model) => model.modelId === value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        message: "The default model must belong to the default provider.",
        path: ["defaultModelId"]
      });
    }
  });

const storedConfigurationV4Schema = z
  .object({
    defaultModelId: z.string().min(1).max(200),
    defaultProviderId: z.string().uuid(),
    providers: z.array(storedProviderV4Schema).min(1).max(100),
    version: z.literal(4)
  })
  .strict()
  .superRefine((value, context) => {
    const defaultProvider = value.providers.find(
      (provider) => provider.id === value.defaultProviderId
    );
    if (defaultProvider === undefined) {
      context.addIssue({
        code: "custom",
        message: "The default provider must be configured.",
        path: ["defaultProviderId"]
      });
      return;
    }
    if (!defaultProvider.models.some((model) => model.modelId === value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        message: "The default model must belong to the default provider.",
        path: ["defaultModelId"]
      });
    }
  });

const storedConfigurationV5Schema = z
  .object({
    defaultModelId: z.string().min(1).max(200),
    defaultProviderId: z.string().uuid(),
    providers: z.array(storedProviderSchema).min(1).max(100),
    version: z.literal(5)
  })
  .strict()
  .superRefine((value, context) => {
    const defaultProvider = value.providers.find(
      (provider) => provider.id === value.defaultProviderId
    );
    if (defaultProvider === undefined) {
      context.addIssue({
        code: "custom",
        message: "The default provider must be configured.",
        path: ["defaultProviderId"]
      });
      return;
    }
    if (!defaultProvider.models.some((model) => model.modelId === value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        message: "The default model must belong to the default provider.",
        path: ["defaultModelId"]
      });
    }
  });

type StoredConfiguration = z.infer<typeof storedConfigurationV5Schema>;

function normalizeBaseUrl(value: string): string {
  return new URL(value.trim()).toString().replace(/\/$/, "");
}

function migrateLegacyModel(
  model: z.infer<typeof legacyStoredModelSchema>,
  apiFormat: ModelApiFormat
): z.infer<typeof storedModelSchema> {
  const reasoningOption: ModelReasoningOption | undefined =
    model.configuredReasoningEffort === null || model.configuredReasoningEffort === undefined
      ? undefined
      : { kind: "effort", value: model.configuredReasoningEffort };
  return {
    ...(model.contextCompression === undefined
      ? {}
      : { contextCompression: model.contextCompression }),
    contextWindow: model.contextWindow,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
    modelId: model.modelId,
    reasoningOptions: reasoningOption !== undefined &&
      isReasoningOptionSupportedByApiFormat(apiFormat, reasoningOption, model.modelId)
      ? [reasoningOption]
      : []
  };
}

function modelProfile(
  provider: z.infer<typeof storedProviderSchema>,
  model: z.infer<typeof storedModelSchema>
): ModelProfile {
    return {
      ...(model.contextCompression === undefined
        ? {}
        : { contextCompression: model.contextCompression }),
      contextWindow: model.contextWindow,
    connectionStatus: model.connectionStatus ?? "unknown",
    displayName: model.displayName ?? model.modelId,
    modelId: model.modelId,
    providerApiFormat: provider.apiFormat,
    providerBaseUrl: provider.baseUrl,
    providerId: provider.id,
    providerName: provider.name,
    ...(provider.icon === undefined ? {} : { providerIcon: provider.icon }),
    ...(provider.note === undefined ? {} : { providerNote: provider.note }),
    ...(provider.websiteUrl === undefined
      ? {}
      : { providerWebsiteUrl: provider.websiteUrl }),
    reasoningOptions: model.reasoningOptions.filter((option) =>
      isReasoningOptionSupportedByApiFormat(provider.apiFormat, option, model.modelId)
    )
  };
}

function modelEndpoint(baseUrl: string, pathname: string): string {
  return new URL(pathname, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

function discoveryRequest(input: DiscoverModelsInput): { endpoint: string; headers: HeadersInit } {
  if (input.apiFormat === "anthropic-messages") {
    return {
      endpoint: modelEndpoint(input.baseUrl, "models"),
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": input.apiKey
      }
    };
  }
  if (input.apiFormat === "google-gemini") {
    return {
      endpoint: modelEndpoint(input.baseUrl, "models"),
      headers: { "x-goog-api-key": input.apiKey }
    };
  }
  return {
    endpoint: modelEndpoint(input.baseUrl, "models"),
    headers: { Authorization: `Bearer ${input.apiKey}` }
  };
}

function openAiStyleModels(payload: unknown): DiscoveredModel[] {
  const candidates = Array.isArray(
    payload !== null && typeof payload === "object"
      ? (payload as { data?: unknown }).data
      : undefined
  )
    ? (payload as { data: unknown[] }).data
    : [];
  return candidates.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== "object") return [];
    const id = (candidate as { id?: unknown }).id;
    const ownedBy = (candidate as { owned_by?: unknown; ownedBy?: unknown }).owned_by
      ?? (candidate as { ownedBy?: unknown }).ownedBy;
    if (typeof id !== "string" || id.trim().length === 0) return [];
    return [{
      modelId: id.trim(),
      ownedBy: typeof ownedBy === "string" && ownedBy.trim().length > 0
        ? ownedBy.trim()
        : null
    }];
  });
}

function googleModels(payload: unknown): DiscoveredModel[] {
  const candidates = Array.isArray(
    payload !== null && typeof payload === "object"
      ? (payload as { models?: unknown }).models
      : undefined
  )
    ? (payload as { models: unknown[] }).models
    : [];
  return candidates.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== "object") return [];
    const name = (candidate as { name?: unknown }).name;
    const displayName = (candidate as { displayName?: unknown }).displayName;
    if (typeof name !== "string" || name.trim().length === 0) return [];
    return [{
      modelId: name.trim().replace(/^models\//, ""),
      ownedBy: typeof displayName === "string" && displayName.trim().length > 0
        ? displayName.trim()
        : "Google"
    }];
  });
}

function uniqueModels(models: readonly DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();
  for (const model of models) {
    if (!byId.has(model.modelId)) byId.set(model.modelId, model);
  }
  return [...byId.values()].sort((left, right) =>
    left.modelId.localeCompare(right.modelId)
  );
}

export class ModelCredentialStore {
  public constructor(private readonly configurationPath: string) {}

  public importFromEnvironment(): void {
    if (existsSync(this.configurationPath)) {
      return;
    }
    const baseUrl = process.env.AGENT_MODEL_BASE_URL?.trim();
    const apiKey = process.env.AGENT_MODEL_API_KEY?.trim();
    const modelId = process.env.AGENT_MODEL_ID?.trim();
    if (baseUrl === undefined || apiKey === undefined || modelId === undefined) {
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential encryption is unavailable.");
    }
    const providerId = randomUUID();
    const stored = storedConfigurationV5Schema.parse({
      defaultModelId: modelId,
      defaultProviderId: providerId,
      providers: [{
        apiFormat: "openai-chat-completions",
        baseUrl: normalizeBaseUrl(baseUrl),
        encryptedApiKey: safeStorage.encryptString(apiKey).toString("base64"),
        id: providerId,
        models: [{
          contextWindow: 0,
          displayName: modelId,
          modelId,
          reasoningOptions: []
        }],
        name: "环境变量供应商"
      }],
      version: 5
    });
    this.writeStoredConfiguration(stored);
  }

  public getConfiguration(providerId?: string, modelId?: string): ModelConfiguration {
    const stored = this.readStoredConfiguration();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential decryption is unavailable.");
    }
    const selectedProvider = this.getProvider(stored, providerId);
    const selectedModelId = modelId ?? (
      selectedProvider.id === stored.defaultProviderId
        ? stored.defaultModelId
        : selectedProvider.models[0]?.modelId
    );
    if (selectedModelId === undefined) {
      throw new Error("The selected provider has no configured models.");
    }
    const selectedModel = selectedProvider.models.find(
      (model) => model.modelId === selectedModelId
    );
    if (selectedModel === undefined) {
      throw new Error("The selected model is not configured.");
    }
    return {
      apiKey: safeStorage.decryptString(
        Buffer.from(selectedProvider.encryptedApiKey, "base64")
      ),
      apiFormat: selectedProvider.apiFormat,
      baseUrl: selectedProvider.baseUrl,
      ...(selectedModel.contextCompression === undefined
        ? {}
        : { contextCompression: selectedModel.contextCompression }),
      contextWindow: selectedModel.contextWindow,
      modelId: selectedModelId,
      reasoningOptions: selectedModel.reasoningOptions.filter((option) =>
        isReasoningOptionSupportedByApiFormat(selectedProvider.apiFormat, option, selectedModel.modelId)
      )
    };
  }

  public getApiKey(providerId: string): string | null {
    if (!existsSync(this.configurationPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential decryption is unavailable.");
    }
    const stored = this.readStoredConfiguration();
    const provider = this.getProvider(stored, providerId);
    return safeStorage.decryptString(Buffer.from(provider.encryptedApiKey, "base64"));
  }

  public async discoverModels(
    input: DiscoverModelsInput
  ): Promise<DiscoveredModel[]> {
    const request = discoveryRequest(input);
    const response = await fetch(request.endpoint, {
      headers: request.headers,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(`Unable to fetch models (${response.status}).`);
    }

    const payload: unknown = await response.json();
    const models = input.apiFormat === "google-gemini"
      ? googleModels(payload)
      : openAiStyleModels(payload);
    if (models.length === 0) {
      throw new Error("The provider did not return any compatible models.");
    }
    return uniqueModels(models);
  }

  public async testModelConnection(
    providerId: string,
    modelId: string,
  ): Promise<{ content: string; modelId: string }> {
    try {
      const configuration = this.getConfiguration(providerId, modelId);
      const result = await new ModelAdapterRegistry().completeTurn({
        configuration,
        maxOutputTokens: 64,
        messages: [{
          attachments: [],
          content: "hi!",
          role: "user",
          toolCallId: null,
          toolCalls: [],
        }],
        onTextDelta: () => undefined,
        reasoning: undefined,
        signal: AbortSignal.timeout(20_000),
        tools: [],
      });
      const content = result.content.trim();
      if (content.length === 0) {
        throw new ModelResponseError("Model did not return a reply.");
      }
      this.setModelConnectionStatus(providerId, modelId, "healthy");
      return { content: content.slice(0, 2_000), modelId };
    } catch (error) {
      this.setModelConnectionStatus(providerId, modelId, "error");
      throw error;
    }
  }

  public setModelConnectionStatus(
    providerId: string,
    modelId: string,
    connectionStatus: Exclude<ModelConnectionStatus, "unknown">
  ): void {
    const existing = this.readStoredConfiguration();
    const provider = this.getProvider(existing, providerId);
    if (!provider.models.some((model) => model.modelId === modelId)) {
      throw new Error("The selected model is not configured.");
    }
    this.writeStoredConfiguration(storedConfigurationV5Schema.parse({
      ...existing,
      providers: existing.providers.map((current) => current.id !== provider.id ? current : {
        ...current,
        models: current.models.map((model) => model.modelId === modelId
          ? { ...model, connectionStatus }
          : model)
      })
    }));
  }

  public saveConfiguration(
    input: SaveModelConfigurationInput
  ): ModelRuntimeStatus {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential encryption is unavailable.");
    }
    const providerId = input.providerId ?? randomUUID();
    const existing = existsSync(this.configurationPath)
      ? this.readStoredConfiguration()
      : null;
    const existingProvider = existing?.providers.find((provider) => provider.id === providerId);
    const existingStatuses = new Map(existingProvider?.models.map((model) => [
      model.modelId,
      model.connectionStatus,
    ]));
    const provider = storedProviderSchema.parse({
      apiFormat: input.apiFormat,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      encryptedApiKey: safeStorage.encryptString(input.apiKey).toString("base64"),
      id: providerId,
      ...(input.providerIcon === undefined ? {} : { icon: input.providerIcon }),
      models: input.models.map((model) => ({
        ...model,
        ...(existingStatuses.get(model.modelId) === undefined
          ? {}
          : { connectionStatus: existingStatuses.get(model.modelId) })
      })),
      name: input.providerName,
      ...(input.providerNote === undefined ? {} : { note: input.providerNote }),
      ...(input.providerWebsiteUrl === undefined
        ? {}
        : { websiteUrl: input.providerWebsiteUrl })
    });
    const providers = existing === null
      ? [provider]
      : existing.providers.some((current) => current.id === providerId)
        ? existing.providers.map((current) => current.id === providerId ? provider : current)
        : [...existing.providers, provider];
    const defaultProviderId = existing?.defaultProviderId ?? providerId;
    const defaultProvider = providers.find(
      (current) => current.id === defaultProviderId
    );
    const defaultModelId = defaultProvider?.models.some(
      (model) => model.modelId === existing?.defaultModelId
    )
      ? existing?.defaultModelId
      : defaultProvider?.models[0]?.modelId;
    if (defaultProvider === undefined || defaultModelId === undefined) {
      throw new Error("The default provider must have a configured model.");
    }
    const stored = storedConfigurationV5Schema.parse({
      defaultModelId,
      defaultProviderId,
      providers,
      version: 5
    });
    this.writeStoredConfiguration(stored);
    return this.getStatus();
  }

  public setDefaultModel(input: SetDefaultModelInput): ModelRuntimeStatus {
    const existing = this.readStoredConfiguration();
    const provider = this.getProvider(existing, input.providerId);
    if (!provider.models.some((model) => model.modelId === input.modelId)) {
      throw new Error("The default model must belong to the selected provider.");
    }
    const stored = storedConfigurationV5Schema.parse({
      ...existing,
      defaultModelId: input.modelId,
      defaultProviderId: input.providerId
    });
    this.writeStoredConfiguration(stored);
    return this.getStatus();
  }

  public getStatus(): ModelRuntimeStatus {
    if (!existsSync(this.configurationPath)) {
      return modelRuntimeStatusSchema.parse({
        baseUrl: null,
        configured: false,
        modelId: null,
        models: [],
        providerId: null,
        supportsStreaming: true,
        supportsTools: true
      });
    }
    const stored = this.readStoredConfiguration();
    const defaultProvider = this.getProvider(stored);
    return modelRuntimeStatusSchema.parse({
      baseUrl: defaultProvider.baseUrl,
      configured: true,
      modelId: stored.defaultModelId,
      models: stored.providers.flatMap((provider) =>
        provider.models.map((model) => modelProfile(provider, model))
      ),
      providerId: stored.defaultProviderId,
      supportsStreaming: true,
      supportsTools: true
    });
  }

  private readStoredConfiguration(): StoredConfiguration {
    if (!existsSync(this.configurationPath)) {
      throw new Error("No model provider is configured.");
    }
    const parsed = readJsonDocument(this.configurationPath);
    const current = storedConfigurationV5Schema.safeParse(parsed);
    if (current.success) return current.data;

    const previousV4 = storedConfigurationV4Schema.safeParse(parsed);
    if (previousV4.success) return this.migrateV4Configuration(previousV4.data);

    const previousV3 = storedConfigurationV3Schema.safeParse(parsed);
    if (previousV3.success) return this.migrateV3Configuration(previousV3.data);

    const previousV2 = storedConfigurationV2Schema.safeParse(parsed);
    if (previousV2.success) {
      return this.legacyConfiguration({
        baseUrl: previousV2.data.baseUrl,
        encryptedApiKey: previousV2.data.encryptedApiKey,
        modelId: previousV2.data.defaultModelId,
        models: previousV2.data.models
      });
    }

    const previous = storedConfigurationV1Schema.parse(parsed);
    return this.legacyConfiguration({
      baseUrl: previous.baseUrl,
      encryptedApiKey: previous.encryptedApiKey,
      modelId: previous.modelId,
      models: [{
        contextWindow: 0,
        displayName: previous.modelId,
        modelId: previous.modelId
      }]
    });
  }

  private legacyConfiguration({
    baseUrl,
    encryptedApiKey,
    modelId,
    models
  }: {
    baseUrl: string;
    encryptedApiKey: string;
    modelId: string;
    models: z.infer<typeof legacyStoredModelSchema>[];
  }): StoredConfiguration {
    return {
      defaultModelId: modelId,
      defaultProviderId: LEGACY_PROVIDER_ID,
      providers: [{
        apiFormat: "openai-chat-completions",
        baseUrl,
        encryptedApiKey,
        id: LEGACY_PROVIDER_ID,
        models: models.map((model) => migrateLegacyModel(model, "openai-chat-completions")),
        name: "默认供应商"
      }],
      version: 5
    };
  }

  private migrateV3Configuration(
    configuration: z.infer<typeof storedConfigurationV3Schema>
  ): StoredConfiguration {
    return {
      defaultModelId: configuration.defaultModelId,
      defaultProviderId: configuration.defaultProviderId,
      providers: configuration.providers.map((provider) => ({
        ...provider,
        apiFormat: "openai-chat-completions",
        models: provider.models.map((model) =>
          migrateLegacyModel(model, "openai-chat-completions")
        )
      })),
      version: 5
    };
  }

  private migrateV4Configuration(
    configuration: z.infer<typeof storedConfigurationV4Schema>
  ): StoredConfiguration {
    return {
      defaultModelId: configuration.defaultModelId,
      defaultProviderId: configuration.defaultProviderId,
      providers: configuration.providers.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => migrateLegacyModel(model, provider.apiFormat))
      })),
      version: 5
    };
  }

  private getProvider(
    stored: StoredConfiguration,
    providerId?: string
  ): z.infer<typeof storedProviderSchema> {
    const id = providerId ?? stored.defaultProviderId;
    const provider = stored.providers.find((candidate) => candidate.id === id);
    if (provider === undefined) throw new Error("The selected provider is not configured.");
    return provider;
  }

  private writeStoredConfiguration(stored: StoredConfiguration): void {
    writeJsonDocument(this.configurationPath, stored);
  }
}
