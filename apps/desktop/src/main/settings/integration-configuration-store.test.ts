import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConfigurationStore } from "./integration-configuration-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("IntegrationConfigurationStore", () => {
  it("returns an empty configuration before the first save", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-"));
    temporaryDirectories.push(directory);
    const store = new IntegrationConfigurationStore(path.join(directory, "missing.json"));

    expect(store.getConfiguration()).toEqual({
      mcpServers: [],
      skillDirectories: [],
      skills: [],
      version: 1,
    });
  });

  it("validates and atomically persists MCP and Skill configuration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "integration-settings.json");
    const store = new IntegrationConfigurationStore(configurationPath);
    const configuration = {
      mcpServers: [{
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        command: "npx",
        enabled: true,
        env: {},
        headers: {},
        id: "filesystem",
        name: "Filesystem",
        scope: "user" as const,
        transport: "stdio" as const,
        url: null,
      }],
      skillDirectories: [],
      skills: [{
        description: "Review changes",
        enabled: true,
        entryPath: "C:\\skills\\review\\SKILL.md",
        id: "review",
        mcpDependencies: ["filesystem"],
        name: "Review",
        scope: "user" as const,
        version: "1.0.0",
      }],
      version: 1 as const,
    };

    expect(store.saveConfiguration(configuration)).toEqual(configuration);
    expect(store.getConfiguration()).toEqual(configuration);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(configuration);
  });
});
