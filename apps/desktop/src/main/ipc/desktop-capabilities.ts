import { capabilitySetSchema } from "@agent/protocol";

export const DESKTOP_CAPABILITIES = capabilitySetSchema.parse({
  mode: "desktop",
  workspace: true,
  fileWrite: true,
  process: true,
  pty: false,
  git: false,
  managedBrowser: false,
  mcp: false,
  skills: false,
  docxConversion: false,
});
