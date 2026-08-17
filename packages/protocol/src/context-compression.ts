import { z } from "zod";

export const contextCompressionModeSchema = z.enum(["tokens", "percentage"]);

export const contextCompressionThresholdSchema = z
  .object({
    mode: contextCompressionModeSchema,
    percentageThreshold: z.number().int().min(1).max(100),
    tokenThreshold: z.number().int().min(1).max(10_000_000)
  })
  .strict();

export const DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION = {
  mode: "percentage",
  percentageThreshold: 80,
  tokenThreshold: 100_000,
  version: 1
} as const;

export const contextCompressionConfigurationSchema = z
  .object({
    mode: contextCompressionModeSchema,
    percentageThreshold: z.number().int().min(1).max(100),
    tokenThreshold: z.number().int().min(1).max(10_000_000),
    version: z.literal(1)
  })
  .strict();

export type ContextCompressionConfiguration = z.infer<
  typeof contextCompressionConfigurationSchema
>;
export type ContextCompressionMode = z.infer<typeof contextCompressionModeSchema>;
export type ContextCompressionThreshold = z.infer<typeof contextCompressionThresholdSchema>;

export function resolveContextCompressionThresholdTokens(
  configuration: ContextCompressionThreshold,
  contextWindowTokens: number
): number {
  const requestedThreshold = configuration.mode === "tokens"
    ? configuration.tokenThreshold
    : contextWindowTokens > 0
      ? Math.floor((contextWindowTokens * configuration.percentageThreshold) / 100)
      : configuration.tokenThreshold;

  return contextWindowTokens > 0
    ? Math.min(requestedThreshold, contextWindowTokens)
    : requestedThreshold;
}
