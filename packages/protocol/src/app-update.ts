import { z } from "zod";

export const appUpdateProgressSchema = z.object({
  transferred: z.number().nonnegative(),
  total: z.number().positive(),
  bytesPerSecond: z.number().nonnegative(),
  mode: z.enum(["full", "differential"]),
}).strict();

export const appUpdateStateSchema = z.object({
  status: z.enum(["unavailable", "idle", "checking", "up-to-date", "available", "downloading", "paused", "downloaded", "error"]),
  currentVersion: z.string().min(1),
  availableVersion: z.string().min(1).nullable(),
  progress: appUpdateProgressSchema.nullable(),
  message: z.string().max(500).nullable(),
}).strict();

export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;
export type AppUpdateProgress = z.infer<typeof appUpdateProgressSchema>;
