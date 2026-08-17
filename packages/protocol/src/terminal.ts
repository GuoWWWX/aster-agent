import { z } from "zod";

export const terminalShellSchema = z.enum([
  "system",
  "powershell",
  "pwsh",
  "cmd",
  "bash",
]);

export const terminalOutputEncodingSchema = z.enum([
  "auto",
  "utf-8",
  "gbk",
  "gb18030",
  "utf-16le",
]);

export const terminalConfigurationSchema = z
  .object({
    fontFamily: z.string().trim().min(1).max(300),
    fontSize: z.number().int().min(10).max(28),
    lineHeight: z.number().min(1).max(2.2),
    outputEncoding: terminalOutputEncodingSchema,
    shell: terminalShellSchema,
    version: z.literal(1),
  })
  .strict();

export type TerminalShell = z.infer<typeof terminalShellSchema>;
export type TerminalOutputEncoding = z.infer<typeof terminalOutputEncodingSchema>;
export type TerminalConfiguration = z.infer<typeof terminalConfigurationSchema>;

export const DEFAULT_TERMINAL_CONFIGURATION: TerminalConfiguration = {
  fontFamily: "Cascadia Mono, Consolas, 'Microsoft YaHei UI', monospace",
  fontSize: 12,
  lineHeight: 1.55,
  outputEncoding: "auto",
  shell: "system",
  version: 1,
};
