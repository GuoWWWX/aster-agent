import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  conversationModelSelectionSchema,
  contextCompressionThresholdSchema,
  isReasoningOptionEnabled,
  isReasoningOptionSupportedByApiFormat,
  modelApiFormatSchema,
  modelConnectionStatusSchema,
  modelProviderIconSchema,
  modelReasoningOptionSchema,
  modelReasoningOptionKey,
  modelRuntimeStatusSchema,
  type DiscoverModelsInput,
  type DiscoveredModel,
  type ConversationModelSelection,
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
import type { ModelConfiguration, ModelContextConfiguration } from "./model-contracts.js";
import { ModelResponseError } from "./model-request-error.js";

export type { ModelConfiguration, ModelContextConfiguration } from "./model-contracts.js";

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
  connectionStatusUpdatedAt: z.string().datetime().nullable().optional(),
  lastSuccessfulAt: z.string().datetime().nullable().optional(),
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

const storedRecentSelectionSchema = conversationModelSelectionSchema.extend({
  updatedAt: z.string().datetime()
}).strict();

const storedConfigurationV6Schema = z
  .object({
    defaultModelId: z.string().min(1).max(200),
    defaultProviderId: z.string().uuid(),
    providers: z.array(storedProviderSchema).min(1).max(100),
    recentSelection: storedRecentSelectionSchema.nullable(),
    version: z.literal(6)
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

type StoredConfiguration = z.infer<typeof storedConfigurationV6Schema>;
type StoredProvider = z.infer<typeof storedProviderSchema>;
type StoredModel = z.infer<typeof storedModelSchema>;

type SelectedStoredModel = {
  model: StoredModel;
  modelId: string;
  provider: StoredProvider;
};

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
      connectionStatusUpdatedAt: model.connectionStatusUpdatedAt ?? null,
    displayName: model.displayName ?? model.modelId,
      modelId: model.modelId,
      lastSuccessfulAt: model.lastSuccessfulAt ?? null,
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
    const stored = storedConfigurationV6Schema.parse({
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
      recentSelection: null,
      version: 6
    });
    this.writeStoredConfiguration(stored);
  }

  public getConfiguration(providerId?: string, modelId?: string): ModelConfiguration {
    const selected = this.getSelectedModel(providerId, modelId);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating-system credential decryption is unavailable.");
    }
    return {
      ...this.toContextConfiguration(selected),
      apiKey: safeStorage.decryptString(
        Buffer.from(selected.provider.encryptedApiKey, "base64")
      ),
    };
  }

  public getContextConfiguration(
    providerId?: string,
    modelId?: string,
  ): ModelContextConfiguration {
    return this.toContextConfiguration(this.getSelectedModel(providerId, modelId));
  }

  private getSelectedModel(providerId?: string, modelId?: string): SelectedStoredModel {
    const stored = this.readStoredConfiguration();
    const provider = this.getProvider(stored, providerId);
    const selectedModelId = modelId ?? (
      provider.id === stored.defaultProviderId
        ? stored.defaultModelId
        : provider.models[0]?.modelId
    );
    if (selectedModelId === undefined) {
      throw new Error("The selected provider has no configured models.");
    }
    const model = provider.models.find((candidate) => candidate.modelId === selectedModelId);
    if (model === undefined) {
      throw new Error("The selected model is not configured.");
    }
    return { model, modelId: selectedModelId, provider };
  }

  private toContextConfiguration(selected: SelectedStoredModel): ModelContextConfiguration {
    const { model, modelId, provider } = selected;
    return {
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      ...(model.contextCompression === undefined
        ? {}
        : { contextCompression: model.contextCompression }),
      contextWindow: model.contextWindow,
      modelId,
      reasoningOptions: model.reasoningOptions.filter((option) =>
        isReasoningOptionSupportedByApiFormat(provider.apiFormat, option, model.modelId)
      )
    };
  }

  public getPreferredSelection(): ConversationModelSelection | null {
    if (!existsSync(this.configurationPath)) return null;
    const stored = this.readStoredConfiguration();
    return this.normalizeSelection(stored, stored.recentSelection ?? {
      modelId: stored.defaultModelId,
      providerId: stored.defaultProviderId,
      reasoning: null,
    }) ?? this.normalizeSelection(stored, {
      modelId: stored.defaultModelId,
      providerId: stored.defaultProviderId,
      reasoning: null,
    });
  }

  public setRecentSelection(selection: ConversationModelSelection): ModelRuntimeStatus {
    const existing = this.readStoredConfiguration();
    const normalized = this.normalizeSelection(existing, selection);
    if (normalized === null) {
      throw new Error("The selected model or reasoning option is not configured.");
    }
    this.writeStoredConfiguration(storedConfigurationV6Schema.parse({
      ...existing,
      recentSelection: {
        ...normalized,
        updatedAt: new Date().toISOString(),
      },
    }));
    return this.getStatus();
  }

  public resolveSelection(selection: ConversationModelSelection): ConversationModelSelection {
    const normalized = this.normalizeSelection(this.readStoredConfiguration(), selection);
    if (normalized === null) {
      throw new Error("The selected model or reasoning option is not configured.");
    }
    return normalized;
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
    const updatedAt = new Date().toISOString();
    this.writeStoredConfiguration(storedConfigurationV6Schema.parse({
      ...existing,
      providers: existing.providers.map((current) => current.id !== provider.id ? current : {
        ...current,
        models: current.models.map((model) => model.modelId === modelId
          ? {
              ...model,
              connectionStatus,
              connectionStatusUpdatedAt: updatedAt,
              ...(connectionStatus === "healthy" ? { lastSuccessfulAt: updatedAt } : {}),
            }
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
      {
        connectionStatus: model.connectionStatus,
        connectionStatusUpdatedAt: model.connectionStatusUpdatedAt,
        lastSuccessfulAt: model.lastSuccessfulAt,
      },
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
          : existingStatuses.get(model.modelId))
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
    const candidateRecentSelection = existing?.recentSelection ?? null;
    const storedWithoutRecentSelection = {
      defaultModelId,
      defaultProviderId,
      providers,
      recentSelection: null,
      version: 6 as const,
    };
    const recentSelection = candidateRecentSelection === null
      ? null
      : this.normalizeSelection(storedWithoutRecentSelection, candidateRecentSelection);
    const stored = storedConfigurationV6Schema.parse({
      ...storedWithoutRecentSelection,
      recentSelection: recentSelection === null ? null : {
        ...recentSelection,
        updatedAt: candidateRecentSelection?.updatedAt,
      },
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
    const stored = storedConfigurationV6Schema.parse({
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
        recentSelection: null,
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
      recentSelection: stored.recentSelection === null
        ? null
        : this.normalizeSelection(stored, stored.recentSelection),
      supportsStreaming: true,
      supportsTools: true
    });
  }

  private readStoredConfiguration(): StoredConfiguration {
    if (!existsSync(this.configurationPath)) {
      throw new Error("No model provider is configured.");
    }
    const parsed = readJsonDocument(this.configurationPath);
    const current = storedConfigurationV6Schema.safeParse(parsed);
    if (current.success) return current.data;

    const previousV5 = storedConfigurationV5Schema.safeParse(parsed);
    if (previousV5.success) return {
      ...previousV5.data,
      recentSelection: null,
      version: 6,
    };

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
      recentSelection: null,
      version: 6
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
      recentSelection: null,
      version: 6
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
      recentSelection: null,
      version: 6
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

  private normalizeSelection(
    stored: Pick<StoredConfiguration, "defaultModelId" | "defaultProviderId" | "providers">,
    selection: ConversationModelSelection,
  ): ConversationModelSelection | null {
    const provider = stored.providers.find((candidate) => candidate.id === selection.providerId);
    const model = provider?.models.find((candidate) => candidate.modelId === selection.modelId);
    if (model === undefined) return null;
    if (selection.reasoning === null) return {
      modelId: selection.modelId,
      providerId: selection.providerId,
      reasoning: null,
    };
    const key = modelReasoningOptionKey(selection.reasoning);
    const reasoning = model.reasoningOptions.find((candidate) =>
      modelReasoningOptionKey(candidate) === key && isReasoningOptionEnabled(candidate)
    );
    return reasoning === undefined ? null : {
      modelId: selection.modelId,
      providerId: selection.providerId,
      reasoning,
    };
  }

  private writeStoredConfiguration(stored: StoredConfiguration): void {
    writeJsonDocument(this.configurationPath, stored);
  }
}
