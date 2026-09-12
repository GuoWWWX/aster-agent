import { z } from "zod";

export const backendSendCommandSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(100_000),
  modelId: z.string().trim().min(1).max(200).optional(),
  providerId: z.string().uuid().optional(),
}).strict();

export type BackendSendCommand = z.infer<typeof backendSendCommandSchema>;

export function parseBackendSendCommand(
  commandLine: readonly string[],
): BackendSendCommand | undefined {
  const argument = commandLine.find((value) => value.startsWith("--aster-send="));
  if (argument === undefined) return undefined;
  try {
    const parsed = backendSendCommandSchema.safeParse(
      JSON.parse(argument.slice("--aster-send=".length)),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
