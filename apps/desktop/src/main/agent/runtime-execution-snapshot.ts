import { createHash } from "node:crypto";
import {
  type ContextCompressionThreshold,
  type ConversationPermissionMode,
  type ModelReasoningOption,
} from "@agent/protocol";
import type { ModelConfiguration } from "../model/model-contracts.js";
import { type ModelToolDefinition } from "../model/model-contracts.js";
import { type RunExecutionSnapshot } from "../storage/agent-database.js";

export function createRunExecutionSnapshot(input: {
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  permissionMode: ConversationPermissionMode;
  plugins: readonly { contentHash: string; id: string; version: string }[];
  providerId: string | undefined;
  reasoning: ModelReasoningOption | undefined;
  toolDefinitions: readonly ModelToolDefinition[];
}): RunExecutionSnapshot {
  const { mode, percentageThreshold, tokenThreshold } = input.contextCompressionConfiguration;
  return {
    apiFormat: input.configuration.apiFormat,
    baseUrl: input.configuration.baseUrl,
    contextCompressionConfiguration: {
      mode,
      percentageThreshold,
      tokenThreshold,
    },
    contextWindow: input.configuration.contextWindow ?? null,
    modelId: input.configuration.modelId,
    permissionMode: input.permissionMode,
    plugins: input.plugins.map((plugin) => ({
      contentHash: plugin.contentHash,
      id: plugin.id,
      version: plugin.version,
    })),
    providerId: input.providerId ?? null,
    reasoning: input.reasoning === undefined ? null : structuredClone(input.reasoning),
    reasoningOptions: structuredClone(input.configuration.reasoningOptions),
    toolManifest: createToolManifestSnapshot(input.toolDefinitions),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function createToolManifestSnapshot(definitions: readonly ModelToolDefinition[]): RunExecutionSnapshot["toolManifest"] {
  return definitions
    .map((definition) => ({
      contentHash: createHash("sha256").update(stableJson({
        description: definition.description,
        name: definition.name,
        parameters: definition.parameters,
      }), "utf8").digest("hex"),
      name: definition.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function assertRunToolManifestMatchesSnapshot(
  definitions: readonly ModelToolDefinition[],
  snapshot: RunExecutionSnapshot,
): void {
  // Snapshots created before this field existed remain recoverable. New Runs
  // always contain it, so a restart cannot silently change callable tools.
  if (snapshot.toolManifest.length === 0) return;
  const current = createToolManifestSnapshot(definitions);
  if (JSON.stringify(current) !== JSON.stringify(snapshot.toolManifest)) {
    throw new Error("Queued Run 的 Tool Manifest 已变化，无法安全恢复；请重新发送该消息。");
  }
}

export function assertRunConfigurationMatchesSnapshot(
  configuration: ModelConfiguration,
  snapshot: RunExecutionSnapshot,
): void {
  const sameReasoningOptions = JSON.stringify(configuration.reasoningOptions)
    === JSON.stringify(snapshot.reasoningOptions);
  if (
    configuration.apiFormat !== snapshot.apiFormat
    || configuration.baseUrl !== snapshot.baseUrl
    || configuration.contextWindow !== (snapshot.contextWindow ?? undefined)
    || configuration.modelId !== snapshot.modelId
    || !sameReasoningOptions
  ) {
    throw new Error("Queued Run 的模型配置已变化，无法安全恢复；请重新发送该消息。");
  }
}
