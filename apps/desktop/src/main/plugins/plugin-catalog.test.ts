import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import { PluginCatalog } from "./plugin-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function writePlugin(rootPath: string, input: {
  id?: string;
  name?: string;
  skillContent?: string;
  version?: string;
} = {}): Promise<string> {
  const pluginPath = path.join(rootPath, "example-plugin");
  await mkdir(path.join(pluginPath, "skills"), { recursive: true });
  await writeFile(path.join(pluginPath, "plugin.json"), JSON.stringify({
    id: input.id ?? "example.plugin",
    manifestVersion: 1,
    mcp: [],
    name: input.name ?? "Example Plugin",
    skills: ["skills"],
    templates: [],
    version: input.version ?? "1.0.0",
  }), "utf8");
  await writeFile(path.join(pluginPath, "skills", "SKILL.md"), input.skillContent ?? "# Example\n", "utf8");
  return pluginPath;
}

describe("PluginCatalog", () => {
  it("indexes only declarative packages and preserves the enabled choice when contents change", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-plugin-"));
    temporaryDirectories.push(rootPath);
    const pluginPath = await writePlugin(rootPath);
    const database = new AgentDatabase(":memory:");
    const catalog = new PluginCatalog(database, rootPath);

    const first = await catalog.synchronize();
    expect(first.rejected).toEqual([]);
    expect(first.plugins).toEqual([
      expect.objectContaining({
        enabled: true,
        id: "example.plugin",
        name: "Example Plugin",
        rootPath: path.resolve(await realpath(pluginPath)),
        version: "1.0.0",
      }),
    ]);
    expect(first.plugins[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);

    catalog.setEnabled("example.plugin", false);
    await writeFile(path.join(pluginPath, "skills", "SKILL.md"), "# Changed\n", "utf8");
    const second = await catalog.synchronize();
    expect(second.plugins[0]).toMatchObject({ enabled: false, id: "example.plugin" });
    expect(second.plugins[0]?.contentHash).not.toBe(first.plugins[0]?.contentHash);
    database.close();
  });

  it("rejects invalid or unsafe manifests without preventing other packages from being cataloged", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-plugin-"));
    temporaryDirectories.push(rootPath);
    await writePlugin(rootPath);
    const invalidPath = path.join(rootPath, "unsafe-plugin");
    await mkdir(invalidPath, { recursive: true });
    await writeFile(path.join(invalidPath, "plugin.json"), JSON.stringify({
      id: "unsafe.plugin",
      manifestVersion: 1,
      mcp: [],
      name: "Unsafe Plugin",
      skills: ["../outside"],
      templates: [],
      version: "1.0.0",
    }), "utf8");
    const database = new AgentDatabase(":memory:");
    const catalog = new PluginCatalog(database, rootPath);

    const result = await catalog.synchronize();
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(["example.plugin"]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ directoryName: "unsafe-plugin" }),
    ]);
    database.close();
  });
});
