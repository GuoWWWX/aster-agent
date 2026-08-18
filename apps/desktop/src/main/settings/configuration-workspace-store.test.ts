import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationWorkspaceStore } from "./configuration-workspace-store.js";
import { IntegrationConfigurationStore } from "./integration-configuration-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

async function createStores() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-configuration-workspace-"));
  temporaryDirectories.push(directory);
  const skillDirectory = path.join(directory, "skills", "review");
  await mkdir(path.join(skillDirectory, "scripts"), { recursive: true });
  const skillEntryPath = path.join(skillDirectory, "SKILL.md");
  await writeFile(skillEntryPath, [
    "---",
    "name: review",
    "description: Review code changes.",
    "---",
    "",
    "# Instructions",
    "",
  ].join("\n"));

  const integrations = new IntegrationConfigurationStore(
    path.join(directory, "integration-settings.json"),
  );
  integrations.saveConfiguration({
    mcpServers: [{
      args: ["-y", "@example/mcp"],
      command: "npx",
      enabled: true,
      env: {},
      headers: {},
      id: "review-mcp",
      name: "Review MCP",
      scope: "user",
      transport: "stdio",
      url: null,
    }],
    skillDirectories: [],
    skills: [{
      description: "Review code changes.",
      enabled: true,
      entryPath: skillEntryPath,
      id: "review",
      mcpDependencies: [],
      name: "review",
      scope: "user",
      version: "",
    }],
    version: 1,
  });
  return {
    integrations,
    workspaces: new ConfigurationWorkspaceStore(integrations, path.join(directory, "mcp")),
  };
}

describe("ConfigurationWorkspaceStore", () => {
  it("limits Skill files to a registered Skill and manages child files", async () => {
    const { workspaces } = await createStores();

    await expect(workspaces.listEntries({
      configurationId: "missing",
      directoryPath: "",
      kind: "skill",
    })).rejects.toThrow(/not registered/i);
    await expect(workspaces.listEntries({
      configurationId: "review",
      directoryPath: "../",
      kind: "skill",
    })).rejects.toThrow();

    const rootListing = await workspaces.listEntries({
      configurationId: "review",
      directoryPath: "",
      kind: "skill",
    });
    expect(rootListing.entries.some((entry) => (
      entry.isProtected && entry.name === "SKILL.md" && entry.path === "SKILL.md"
    ))).toBe(true);
    expect(rootListing.entries.some((entry) => (
      entry.kind === "directory" && entry.name === "scripts" && entry.path === "scripts"
    ))).toBe(true);

    await workspaces.createEntry({
      configurationId: "review",
      entryKind: "file",
      kind: "skill",
      path: "scripts/check.ts",
    });
    await workspaces.writeFile({
      configurationId: "review",
      content: "export const check = true;\n",
      kind: "skill",
      path: "scripts/check.ts",
    });
    await expect(workspaces.readFile({
      configurationId: "review",
      kind: "skill",
      path: "scripts/check.ts",
    })).resolves.toMatchObject({
      content: "export const check = true;\n",
      isProtected: false,
    });
    await workspaces.deleteEntry({
      configurationId: "review",
      kind: "skill",
      path: "scripts/check.ts",
    });
    await expect(workspaces.readFile({
      configurationId: "review",
      kind: "skill",
      path: "scripts/check.ts",
    })).rejects.toThrow();
    await expect(workspaces.deleteEntry({
      configurationId: "review",
      kind: "skill",
      path: "SKILL.md",
    })).rejects.toThrow(/cannot be deleted/i);
  });

  it("updates managed configuration when an entry document is edited", async () => {
    const { integrations, workspaces } = await createStores();

    await workspaces.writeFile({
      configurationId: "review",
      content: [
        "---",
        "name: focused-review",
        "description: Review focused changes.",
        "---",
        "",
        "# Instructions",
        "",
      ].join("\n"),
      kind: "skill",
      path: "SKILL.md",
    });
    expect(integrations.getConfiguration().skills[0]).toMatchObject({
      description: "Review focused changes.",
      name: "focused-review",
    });

    const mcpDocument = await workspaces.readFile({
      configurationId: "review-mcp",
      kind: "mcp",
      path: "mcp.json",
    });
    const mcp = JSON.parse(mcpDocument.content ?? "{}") as Record<string, unknown>;
    const updatedContent = JSON.stringify({
      ...mcp,
      name: "Updated Review MCP",
    }, null, 2);
    const savedMcpDocument = await workspaces.writeFile({
      configurationId: "review-mcp",
      content: updatedContent,
      kind: "mcp",
      path: "mcp.json",
    });
    expect(savedMcpDocument.content).toContain("Updated Review MCP");
    expect(savedMcpDocument.isProtected).toBe(true);
    expect(integrations.getConfiguration().mcpServers[0]).toMatchObject({
      id: "review-mcp",
      name: "Updated Review MCP",
    });
    await expect(workspaces.deleteEntry({
      configurationId: "review-mcp",
      kind: "mcp",
      path: "mcp.json",
    })).rejects.toThrow(/cannot be deleted/i);
  });
});
