import { z } from "zod";

export const applicationStorageLocationSourceSchema = z.enum([
  "custom",
  "default",
  "environment",
]);

export const applicationStorageLocationSchema = z.object({
  activePath: z.string().min(1),
  canChange: z.boolean(),
  configuredPath: z.string().min(1),
  configurationError: z.boolean(),
  defaultPath: z.string().min(1),
  restartRequired: z.boolean(),
  source: applicationStorageLocationSourceSchema,
}).strict();

export type ApplicationStorageLocationSource = z.infer<
  typeof applicationStorageLocationSourceSchema
>;
export type ApplicationStorageLocation = z.infer<typeof applicationStorageLocationSchema>;
