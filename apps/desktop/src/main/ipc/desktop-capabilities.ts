import { capabilitySetSchema } from "@agent/protocol";

export const DESKTOP_CAPABILITIES = capabilitySetSchema.parse({
  mode: "desktop",
  workspace: true,
  fileWrite: true,
  process: true,
  pty: true,
  git: true,
  managedBrowser: true,
  mcp: false,
  skills: true,
  docxConversion: false,
});
