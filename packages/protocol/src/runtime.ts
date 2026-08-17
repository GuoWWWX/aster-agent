import { z } from "zod";

import { capabilitySetSchema } from "./capability.js";

export const runtimePlatformSchema = z.enum(["win32", "darwin", "linux"]);

export type RuntimePlatform = z.infer<typeof runtimePlatformSchema>;

export const runtimeInfoSchema = z
  .object({
    appVersion: z.string().min(1),
    platform: runtimePlatformSchema,
    capabilities: capabilitySetSchema
  })
  .strict();

export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>;

