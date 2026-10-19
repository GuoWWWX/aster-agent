import {
  conversationModelSelectionSchema,
  contextCompressionThresholdSchema,
  isReasoningOptionSupportedByApiFormat,
  modelApiFormatSchema,
  modelConnectionStatusSchema,
  modelProviderIconSchema,
  modelReasoningOptionSchema,
  type ModelApiFormat,
  type ModelReasoningOption,
} from "@agent/protocol";
import {
  z,
} from "zod";

const storedModelBaseSchema = z
  .object({
    modelType: z.enum(["chat", "image"]).optional(),
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

export const storedModelSchema = storedModelBaseSchema.extend({
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

export const storedProviderSchema = z.object({
  apiFormat: modelApiFormatSchema,
  baseUrl: z.string().url(),
  encryptedApiKey: z.string(),
  id: z.string().uuid(),
  icon: modelProviderIconSchema.optional(),
  models: z.array(storedModelSchema).min(1).max(100),
  name: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional()
}).strict();

const settingsProviderSchema = storedProviderSchema.omit({ encryptedApiKey: true }).extend({
  apiKey: z.string(),
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

export const storedConfigurationV6Schema = z
  .object({
    defaultModelId: z.string().min(1).max(200).nullable(),
    defaultProviderId: z.string().uuid().nullable(),
    providers: z.array(storedProviderSchema).max(100),
    recentSelection: storedRecentSelectionSchema.nullable(),
    version: z.literal(6)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.providers.length === 0) {
      if (value.defaultModelId !== null || value.defaultProviderId !== null || value.recentSelection !== null) {
        context.addIssue({ code: "custom", message: "Empty providers cannot retain a model selection." });
      }
      return;
    }
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

export type StoredConfiguration = z.infer<typeof storedConfigurationV6Schema>;

export type StoredProvider = z.infer<typeof storedProviderSchema>;

export type StoredModel = z.infer<typeof storedModelSchema>;

export const settingsModelConfigurationSchema = z.object({
  defaultModelSelection: conversationModelSelectionSchema.nullable(),
  providers: z.array(settingsProviderSchema).max(100),
  recentSelection: storedRecentSelectionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.providers.length === 0 && value.defaultModelSelection === null && value.recentSelection === null) return;
  const provider = value.providers.find(
    (candidate) => candidate.id === value.defaultModelSelection?.providerId,
  );
  if (provider === undefined || !provider.models.some(
    (model) => model.modelId === value.defaultModelSelection?.modelId,
  )) {
    context.addIssue({
      code: "custom",
      message: "The default model selection must reference a configured provider and model.",
      path: ["defaultModelSelection"],
    });
  }
});

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

function legacyConfiguration({
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

function migrateV3Configuration(
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

function migrateV4Configuration(
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

export function parseLegacyModelConfiguration(parsed: unknown): StoredConfiguration {
  const current = storedConfigurationV6Schema.safeParse(parsed);

  if (current.success) return current.data;

  const previousV5 = storedConfigurationV5Schema.safeParse(parsed);

  if (previousV5.success) return {
    ...previousV5.data,
    recentSelection: null,
    version: 6,
  };

  const previousV4 = storedConfigurationV4Schema.safeParse(parsed);

  if (previousV4.success) return migrateV4Configuration(previousV4.data);

  const previousV3 = storedConfigurationV3Schema.safeParse(parsed);

  if (previousV3.success) return migrateV3Configuration(previousV3.data);

  const previousV2 = storedConfigurationV2Schema.safeParse(parsed);

  if (previousV2.success) {
    return legacyConfiguration({
      baseUrl: previousV2.data.baseUrl,
      encryptedApiKey: previousV2.data.encryptedApiKey,
      modelId: previousV2.data.defaultModelId,
      models: previousV2.data.models
    });
  }

  const previous = storedConfigurationV1Schema.parse(parsed);

  return legacyConfiguration({
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
