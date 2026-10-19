import {
  type ContextCompressionConfiguration,
  type ContextCompressionThreshold,
  type ModelApiFormat,
  type ModelProviderIcon,
  type ModelProfile,
  type ModelReasoningOption,
} from "@agent/protocol";

export type ConfiguredProvider = {
  apiFormat: ModelApiFormat;
  baseUrl: string;
  connectionStatus: ModelProfile["connectionStatus"];
  id: string;
  icon: ModelProviderIcon;
  name: string;
  note: string;
  websiteUrl: string;
};

export type ActiveProviderId = string | null | undefined;

export type ProviderSaveState = "idle" | "incomplete" | "pending" | "saving" | "saved";

export type ModelTestResultState =
  | { kind: "testing" }
  | { content: string; kind: "success" }
  | { kind: "failed"; message: string };

export type ConfiguredModelDraft = {
  modelType?: "chat" | "image";
  contextCompression: ContextCompressionThreshold;
  contextWindow: string;
  displayName: string;
  id: string;
  modelId: string;
  reasoningOptions: ModelReasoningOption[];
};

export const DEFAULT_MODEL_API_FORMAT: ModelApiFormat = "openai-chat-completions";

export const PROVIDERS_PER_PAGE = 8;

export const MODEL_TEST_BATCH_SIZE = 10;

export const MODEL_API_FORMAT_OPTIONS: readonly { label: string; value: ModelApiFormat }[] = [
  { label: "OpenAI Chat Completions", value: "openai-chat-completions" },
  { label: "OpenAI Responses", value: "openai-responses" },
  { label: "Anthropic Messages", value: "anthropic-messages" },
  { label: "Google Gemini", value: "google-gemini" },
];

export function contextCompressionThreshold(
  configuration: ContextCompressionConfiguration | ContextCompressionThreshold,
): ContextCompressionThreshold {
  return {
    mode: configuration.mode,
    percentageThreshold: configuration.percentageThreshold,
    tokenThreshold: configuration.tokenThreshold,
  };
}

export function getConfiguredProviders(models: readonly ModelProfile[]): ConfiguredProvider[] {
  const providers = new Map<string, ConfiguredProvider>();
  for (const model of models) {
    if (!providers.has(model.providerId)) {
      providers.set(model.providerId, {
        apiFormat: model.providerApiFormat,
        baseUrl: model.providerBaseUrl,
        connectionStatus: model.connectionStatus,
        id: model.providerId,
        icon: model.providerIcon ?? "auto",
        name: model.providerName,
        note: model.providerNote ?? "",
        websiteUrl: model.providerWebsiteUrl ?? "",
      });
    } else {
      const provider = providers.get(model.providerId);
      if (provider !== undefined) {
        provider.connectionStatus = mergeConnectionStatus(provider.connectionStatus, model.connectionStatus);
      }
    }
  }
  return [...providers.values()];
}

function mergeConnectionStatus(
  current: ModelProfile["connectionStatus"],
  next: ModelProfile["connectionStatus"],
): ModelProfile["connectionStatus"] {
  if (current === "error" || next === "error") return "error";
  if (current === "healthy" || next === "healthy") return "healthy";
  return "unknown";
}

export function connectionStatusLabel(status: ModelProfile["connectionStatus"]): string {
  if (status === "healthy") return "连接正常";
  if (status === "error") return "连接异常";
  return "未测试";
}

export function isOptionalUrlValid(value: string): boolean {
  if (value.trim().length === 0) return true;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function modelApiBaseUrlPlaceholder(apiFormat: ModelApiFormat): string {
  switch (apiFormat) {
    case "anthropic-messages":
      return "https://api.anthropic.com/v1";
    case "google-gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "openai-chat-completions":
    case "openai-responses":
      return "https://api.openai.com/v1";
  }
}
