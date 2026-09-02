import type {
  ContextCompressionThreshold,
  ModelApiFormat,
  ModelReasoningOption,
} from "@agent/protocol";

export type ModelToolCall = {
  arguments: string;
  id: string;
  name: string;
};

export type ModelProviderState = {
  apiFormat: ModelApiFormat;
  baseUrl: string;
  modelId: string;
  payload: unknown;
  usage?: ModelProviderTokenUsage;
};

export type ModelProviderTokenUsage = {
  cacheCreationInputTokens?: number;
  cachedInputTokens?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelConfiguration = {
  apiKey: string;
  apiFormat: ModelApiFormat;
  baseUrl: string;
  contextCompression?: ContextCompressionThreshold;
  contextWindow?: number;
  modelId: string;
  reasoningOptions: ModelReasoningOption[];
};

/** Model metadata safe to use without decrypting a provider credential. */
export type ModelContextConfiguration = Omit<ModelConfiguration, "apiKey">;

export type ModelMessage = {
  attachments: ModelMessageAttachment[];
  content: string;
  providerState?: ModelProviderState;
  role: "system" | "user" | "assistant" | "tool";
  toolCallId: string | null;
  toolCalls: ModelToolCall[];
};

export type ModelMessageAttachment = {
  contextTokens: number;
  id: string;
  mimeType: string;
  name: string;
  projectPath: string | null;
  readState: "full" | "metadata_only" | "preview";
  source: "project" | "upload";
  truncated: boolean;
} & (
  | { content: string; kind: "text" }
  | { data: string | null; kind: "image" }
);

export function modelImageAttachmentCaption(
  attachment: Pick<ModelMessageAttachment, "id" | "name" | "projectPath" | "source">
): string {
  const location = attachment.projectPath === null
    ? "用户上传图片"
    : `项目图片 ${attachment.projectPath}`;
  return [
    `[图片附件 ${attachment.name}]`,
    `attachment_id: ${attachment.id}`,
    `source: ${location}`
  ].join("\n");
}

export type ModelToolDefinition = {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
};

export type ModelTurnResult = {
  content: string;
  finishReason: string | null;
  providerState?: ModelProviderState;
  reasoningContent?: string;
  toolCalls: ModelToolCall[];
};

export type ModelReasoningDelta = {
  delta: string;
  kind: "summary" | "content";
  reset: boolean;
};

export type CompleteTurnInput = {
  configuration: ModelConfiguration;
  maxOutputTokens: number;
  messages: ModelMessage[];
  onReasoningDelta?(event: ModelReasoningDelta): void;
  onTextDelta(delta: string): void;
  reasoning: ModelReasoningOption | undefined;
  signal: AbortSignal;
  tools: ModelToolDefinition[];
};

export interface ModelProviderAdapter {
  completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult>;
}
