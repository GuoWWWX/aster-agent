import { describe, expect, it } from "vitest";

import {
  mcpServerConfigurationListSchema,
  skillConfigurationListSchema,
} from "./integration.js";

describe("integration configuration", () => {
  it("requires the transport-specific MCP entry point", () => {
    const result = mcpServerConfigurationListSchema.safeParse([{
      args: [],
      command: null,
      enabled: true,
      env: {},
      headers: {},
      id: "remote",
      name: "Remote",
      scope: "user",
      transport: "streamable-http",
      url: "",
    }]);

    expect(result.success).toBe(false);
  });

  it("rejects duplicate Skill IDs", () => {
    const skill = {
      description: "",
      enabled: true,
      entryPath: "SKILL.md",
      id: "review",
      mcpDependencies: [],
      name: "Review",
      scope: "project" as const,
      version: "1.0.0",
    };

    expect(skillConfigurationListSchema.safeParse([skill, skill]).success).toBe(false);
  });
});
