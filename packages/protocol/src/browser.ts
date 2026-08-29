import { z } from "zod";

export const browserConfigurationSchema = z.object({
  defaultZoomPercent: z.number().int().min(25).max(500),
  version: z.literal(1),
}).strict();

export type BrowserConfiguration = z.infer<typeof browserConfigurationSchema>;

export const DEFAULT_BROWSER_CONFIGURATION: BrowserConfiguration = {
  defaultZoomPercent: 100,
  version: 1,
};
