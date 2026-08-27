import { z } from "zod";

export const pluginIdSchema = z.string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);

export const pluginCatalogEntrySchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  enabled: z.boolean(),
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(160),
  updatedAt: z.string().datetime(),
  version: z.string().trim().min(1).max(80),
}).strict();

export const pluginCatalogListSchema = z.array(pluginCatalogEntrySchema);

export const setPluginEnabledInputSchema = z.object({
  enabled: z.boolean(),
  pluginId: pluginIdSchema,
}).strict();

export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;
export type SetPluginEnabledInput = z.infer<typeof setPluginEnabledInputSchema>;
