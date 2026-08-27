import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  AgentDatabase,
  type PluginCatalogRecord,
} from "../storage/agent-database.js";

const PLUGIN_MANIFEST_FILE = "plugin.json";
const MAX_PLUGIN_COUNT = 200;
const MAX_PLUGIN_FILES = 500;
const MAX_PLUGIN_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;

const relativeContributionPathSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !path.isAbsolute(value), "Plugin contribution path must be relative.")
  .refine(
    (value) => value.split(/[\\/]/u).every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Plugin contribution path contains an unsafe segment.",
  );

export const pluginManifestSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
  manifestVersion: z.literal(1),
  mcp: z.array(relativeContributionPathSchema).max(64).default([]),
  name: z.string().trim().min(1).max(160),
  skills: z.array(relativeContributionPathSchema).max(64).default([]),
  templates: z.array(relativeContributionPathSchema).max(64).default([]),
  version: z.string().trim().min(1).max(80),
}).strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type PluginCatalogRejection = {
  directoryName: string;
  reason: string;
};

export type PluginCatalogSynchronization = {
  plugins: PluginCatalogRecord[];
  rejected: PluginCatalogRejection[];
};

type DiscoveredPlugin = Omit<PluginCatalogRecord, "enabled" | "updatedAt">;

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalJson(value: PluginManifest): string {
  return JSON.stringify({
    id: value.id,
    manifestVersion: value.manifestVersion,
    mcp: value.mcp,
    name: value.name,
    skills: value.skills,
    templates: value.templates,
    version: value.version,
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Plugin validation error.";
}

/**
 * Catalogs declarative Plugin packages only. A package may point at Skill,
 * MCP and template content, but cannot run JavaScript or bypass ToolRuntime.
 */
export class PluginCatalog {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly pluginsPath: string,
  ) {}

  public async synchronize(): Promise<PluginCatalogSynchronization> {
    await mkdir(this.pluginsPath, { recursive: true, mode: 0o700 });
    const rootPath = await this.resolveDirectory(this.pluginsPath, "Plugin root");
    const entries = (await readdir(rootPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    const plugins: DiscoveredPlugin[] = [];
    const rejected: PluginCatalogRejection[] = [];
    const pluginIds = new Set<string>();

    for (const entry of entries) {
      if (plugins.length + rejected.length >= MAX_PLUGIN_COUNT) {
        rejected.push({ directoryName: entry.name, reason: "Plugin directory limit exceeded." });
        break;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const plugin = await this.readPlugin(path.join(rootPath, entry.name));
        if (pluginIds.has(plugin.id)) {
          throw new Error("Duplicate Plugin id.");
        }
        pluginIds.add(plugin.id);
        plugins.push(plugin);
      } catch (error) {
        rejected.push({ directoryName: entry.name, reason: describeError(error) });
      }
    }

    this.database.syncPluginCatalog(plugins);
    return {
      plugins: this.database.listPluginCatalog(),
      rejected,
    };
  }

  public list(): PluginCatalogRecord[] {
    return this.database.listPluginCatalog();
  }

  public setEnabled(pluginId: string, enabled: boolean): PluginCatalogRecord {
    return this.database.setPluginEnabled(pluginId, enabled);
  }

  private async readPlugin(candidatePath: string): Promise<DiscoveredPlugin> {
    const rootPath = await this.resolveDirectory(candidatePath, "Plugin");
    const manifestPath = path.join(rootPath, PLUGIN_MANIFEST_FILE);
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      throw new Error("Plugin manifest must be a regular file.");
    }
    if (manifestStats.size > MAX_MANIFEST_BYTES) {
      throw new Error("Plugin manifest exceeds the size limit.");
    }
    const manifestContent = await readFile(manifestPath, "utf8");
    if (manifestContent.includes("\0")) throw new Error("Plugin manifest must be UTF-8 text.");
    const manifest = pluginManifestSchema.parse(JSON.parse(manifestContent) as unknown);
    await this.assertContributionDirectories(rootPath, manifest);
    return {
      contentHash: await this.hashDirectory(rootPath),
      id: manifest.id,
      manifestJson: canonicalJson(manifest),
      name: manifest.name,
      rootPath,
      version: manifest.version,
    };
  }

  private async assertContributionDirectories(
    rootPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    const paths = [...manifest.skills, ...manifest.mcp, ...manifest.templates];
    for (const contributionPath of paths) {
      const candidatePath = path.resolve(rootPath, contributionPath);
      if (!isPathInside(rootPath, candidatePath)) {
        throw new Error("Plugin contribution resolves outside the package.");
      }
      await this.resolveDirectory(candidatePath, "Plugin contribution");
    }
  }

  private async hashDirectory(rootPath: string): Promise<string> {
    const hash = createHash("sha256");
    const pending = [rootPath];
    let fileCount = 0;
    let byteCount = 0;

    while (pending.length > 0) {
      const directoryPath = pending.pop();
      if (directoryPath === undefined) continue;
      const entries = (await readdir(directoryPath, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
      for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
        const stats = await lstat(entryPath);
        if (stats.isSymbolicLink()) throw new Error("Plugin packages cannot contain symbolic links.");
        if (stats.isDirectory()) {
          hash.update(`directory:${relativePath}\n`, "utf8");
          pending.push(entryPath);
          continue;
        }
        if (!stats.isFile()) throw new Error("Plugin packages may contain regular files only.");
        fileCount += 1;
        byteCount += stats.size;
        if (fileCount > MAX_PLUGIN_FILES || byteCount > MAX_PLUGIN_BYTES) {
          throw new Error("Plugin package exceeds the file or byte limit.");
        }
        hash.update(`file:${relativePath}:${stats.size}\n`, "utf8");
        hash.update(await readFile(entryPath));
      }
    }
    return hash.digest("hex");
  }

  private async resolveDirectory(candidatePath: string, description: string): Promise<string> {
    const stats = await lstat(candidatePath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${description} must be a regular directory.`);
    }
    return path.resolve(await realpath(candidatePath));
  }
}
