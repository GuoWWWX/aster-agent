import { z } from "zod";

// Only the isolated browser preload and its owning WebContents use these channels.
export const BROWSER_PASSWORD_CHANNELS = {
  configure: "managed_browser.passwords.configure",
  submit: "managed_browser.passwords.submit",
} as const;

export const browserCredentialSchema = z.object({
  origin: z.url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }),
  username: z.string().max(1024),
  password: z.string().min(1).max(4096),
}).strict();
export type BrowserCredential = z.infer<typeof browserCredentialSchema>;
export const browserPasswordConfigurationSchema = z.object({
  enabled: z.boolean(),
  credential: browserCredentialSchema.nullable(),
}).strict();

export const browserConfigurationSchema = z.object({
  askForDownloadLocation: z.boolean().default(false),
  downloadDirectory: z.string().trim().max(4096).default(""),
  savePasswords: z.boolean().default(true),
  defaultZoomPercent: z.number().int().min(25).max(500),
  searchEngine: z.enum(["bing", "duckduckgo", "google"]).default("google"),
  version: z.literal(1),
}).strict();

export type BrowserConfiguration = z.infer<typeof browserConfigurationSchema>;

export const DEFAULT_BROWSER_CONFIGURATION: BrowserConfiguration = {
  askForDownloadLocation: false,
  downloadDirectory: "",
  savePasswords: true,
  defaultZoomPercent: 100,
  searchEngine: "google",
  version: 1,
};
