import { z } from "zod";
export const backgroundCommandSchema = z.object({
  commandId: z.string().uuid(),
  conversationId: z.string().uuid(),
  command: z.string().max(4000),
  mode: z.enum(["batch", "service"]),
  serviceName: z.string().max(120).nullable(),
  workingDirectory: z.string().max(4096),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  exitCode: z.number().int().nullable(),
}).strict();
export const stopBackgroundCommandInputSchema = z.object({ conversationId: z.string().uuid(), commandId: z.string().uuid() }).strict();
export type BackgroundCommand = z.infer<typeof backgroundCommandSchema>;
export type StopBackgroundCommandInput = z.infer<typeof stopBackgroundCommandInputSchema>;
