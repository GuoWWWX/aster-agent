import { z } from "zod";

export const browserConfigurationSchema = z.object({
  askForDownloadLocation: z.boolean().default(false),
  defaultZoomPercent: z.number().int().min(25).max(500),
  searchEngine: z.enum(["bing", "duckduckgo", "google"]).default("google"),
  version: z.literal(1),
}).strict();

export type BrowserConfiguration = z.infer<typeof browserConfigurationSchema>;

export const DEFAULT_BROWSER_CONFIGURATION: BrowserConfiguration = {
  askForDownloadLocation: false,
  defaultZoomPercent: 100,
  searchEngine: "google",
  version: 1,
};
