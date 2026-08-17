import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  configurationWorkspaceDirectoryListingSchema,
  configurationWorkspaceEntrySchema,
  configurationWorkspaceFileSchema,
  createConfigurationWorkspaceEntryInputSchema,
  deleteConfigurationWorkspaceEntryInputSchema,
  listConfigurationWorkspaceEntriesInputSchema,
  mcpServerConfigurationSchema,
  parseSkillMarkdown,
  readConfigurationWorkspaceFileInputSchema,
  writeConfigurationWorkspaceFileInputSchema,
  type ConfigurationWorkspaceDirectoryListing,
  type ConfigurationWorkspaceEntry,
  type ConfigurationWorkspaceFile,
  type ConfigurationWorkspaceKind,
  type CreateConfigurationWorkspaceEntryInput,
  type DeleteConfigurationWorkspaceEntryInput,
  type IntegrationConfiguration,
  type ListConfigurationWorkspaceEntriesInput,
  type McpServerConfiguration,
  type ReadConfigurationWorkspaceFileInput,
  type WriteConfigurationWorkspaceFileInput,
} from "@agent/protocol";

import {
  isPathInsideRoot,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
  resolveWritablePathWithinRoot,
} from "../security/workspace-path.js";
import { readBoundedFilePreview } from "../storage/read-bounded-file-preview.js";
import { IntegrationConfigurationStore } from "./integration-configuration-store.js";

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_FILE_PREVIEW_BYTES = 2_000_000;

type ResolvedWorkspace = {
  configurationId: string;
  kind: ConfigurationWorkspaceKind;
  protectedPath: string;
  rootPath: string;
};

function compareEntries(left: ConfigurationWorkspaceEntry, right: ConfigurationWorkspaceEntry): number {
  if (left.kind === "directory" && right.kind !== "directory") return -1;
  if (left.kind !== "directory" && right.kind === "directory") return 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function isProtectedPath(workspace: ResolvedWorkspace, relativePath: string): boolean {
  return relativePath === workspace.protectedPath;
}

export class ConfigurationWorkspaceStore {
  public constructor(
    private readonly integrationConfiguration: IntegrationConfigurationStore,
    private readonly managedMcpWorkspacesPath: string,
  ) {}

  public async listEntries(
    input: ListConfigurationWorkspaceEntriesInput,
  ): Promise<ConfigurationWorkspaceDirectoryListing> {
    const parsedInput = listConfigurationWorkspaceEntriesInputSchema.parse(input);
    const workspace = await this.resolveWorkspace(parsedInput.kind, parsedInput.configurationId);
    const directoryPath = await this.resolveExistingPath(workspace, parsedInput.directoryPath);
    const directoryInfo = await stat(directoryPath);
    if (!directoryInfo.isDirectory()) throw new Error("Requested configuration workspace path is not a directory.");

    const rawEntries = await readdir(directoryPath, { withFileTypes: true });
    const truncated = rawEntries.length > MAX_DIRECTORY_ENTRIES;
    const entries = await Promise.all(
      rawEntries.slice(0, MAX_DIRECTORY_ENTRIES).map(async (entry) => {
        const relativePath = parsedInput.directoryPath.length === 0
          ? entry.name
          : `${parsedInput.directoryPath}/${entry.name}`;
        const entryPath = path.join(directoryPath, entry.name);
        const info = await lstat(entryPath);
        return configurationWorkspaceEntrySchema.parse({
          isProtected: isProtectedPath(workspace, relativePath),
          kind: entry.isSymbolicLink()
            ? "symlink"
            : entry.isDirectory()
              ? "directory"
              : "file",
          modifiedAt: info.mtime.toISOString(),
          name: entry.name,
          path: relativePath,
        });
      }),
    );

    return configurationWorkspaceDirectoryListingSchema.parse({
      configurationId: workspace.configurationId,
      directoryPath: parsedInput.directoryPath,
      entries: entries.sort(compareEntries),
      kind: workspace.kind,
      rootPath: workspace.rootPath,
      truncated,
    });
  }

  public async readFile(
    input: ReadConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    const parsedInput = readConfigurationWorkspaceFileInputSchema.parse(input);
    const workspace = await this.resolveWorkspace(parsedInput.kind, parsedInput.configurationId);
    const filePath = await this.resolveExistingPath(workspace, parsedInput.path);
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Requested configuration workspace path is not a file.");

    const preview = await readBoundedFilePreview(filePath, MAX_FILE_PREVIEW_BYTES);

    return configurationWorkspaceFileSchema.parse({
      byteLength: preview.byteLength,
      configurationId: workspace.configurationId,
      content: preview.content,
      isBinary: preview.isBinary,
      isProtected: isProtectedPath(workspace, parsedInput.path),
      kind: workspace.kind,
      name: path.basename(filePath),
      path: parsedInput.path,
      truncated: preview.truncated,
    });
  }

  public async createEntry(
    input: CreateConfigurationWorkspaceEntryInput,
  ): Promise<ConfigurationWorkspaceEntry> {
    const parsedInput = createConfigurationWorkspaceEntryInputSchema.parse(input);
    const workspace = await this.resolveWorkspace(parsedInput.kind, parsedInput.configurationId);
    if (isProtectedPath(workspace, parsedInput.path)) {
      throw new Error("The required configuration entry cannot be replaced.");
    }
    const entryPath = await this.resolveWritablePath(workspace, parsedInput.path);
    if (parsedInput.entryKind === "directory") {
      await mkdir(entryPath);
    } else {
      await writeFile(entryPath, "", { encoding: "utf8", flag: "wx" });
    }
    return configurationWorkspaceEntrySchema.parse({
      isProtected: false,
      kind: parsedInput.entryKind,
      name: path.basename(entryPath),
      path: parsedInput.path,
    });
  }

  public async writeFile(
    input: WriteConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    const parsedInput = writeConfigurationWorkspaceFileInputSchema.parse(input);
    const workspace = await this.resolveWorkspace(parsedInput.kind, parsedInput.configurationId);

    if (workspace.kind === "mcp" && parsedInput.path === workspace.protectedPath) {
      const content = await this.saveMcpDocument(workspace.configurationId, parsedInput.content);
      return this.toTextFile(workspace, parsedInput.path, content);
    }

    if (workspace.kind === "skill" && parsedInput.path === workspace.protectedPath) {
      const metadata = parseSkillMarkdown(parsedInput.content).metadata;
      const configuration = this.integrationConfiguration.getConfiguration();
      const updated = {
        ...configuration,
        skills: configuration.skills.map((skill) =>
          skill.id === workspace.configurationId
            ? { ...skill, description: metadata.description, name: metadata.name }
            : skill,
        ),
      };
      this.integrationConfiguration.saveConfiguration(updated);
    }

    const filePath = await this.resolveWritablePath(workspace, parsedInput.path);
    await this.writeAtomically(filePath, parsedInput.content);
    return this.toTextFile(workspace, parsedInput.path, parsedInput.content);
  }

  public async deleteEntry(input: DeleteConfigurationWorkspaceEntryInput): Promise<void> {
    const parsedInput = deleteConfigurationWorkspaceEntryInputSchema.parse(input);
    const workspace = await this.resolveWorkspace(parsedInput.kind, parsedInput.configurationId);
    if (isProtectedPath(workspace, parsedInput.path)) {
      throw new Error("The required configuration entry cannot be deleted.");
    }
    const entryPath = await this.resolveWritablePath(workspace, parsedInput.path);
    const entryInfo = await lstat(entryPath);
    await rm(entryPath, { force: false, recursive: entryInfo.isDirectory() });
  }

  public async synchronizeMcpDocuments(configuration: IntegrationConfiguration): Promise<void> {
    await Promise.all(
      configuration.mcpServers.map((server) => this.writeMcpDocument(server)),
    );
  }

  private async resolveWorkspace(
    kind: ConfigurationWorkspaceKind,
    configurationId: string,
  ): Promise<ResolvedWorkspace> {
    const configuration = this.integrationConfiguration.getConfiguration();
    if (kind === "skill") {
      const skill = configuration.skills.find((candidate) => candidate.id === configurationId);
      if (skill === undefined) throw new Error("Skill is not registered in this application.");
      const rootPath = path.dirname(path.resolve(skill.entryPath));
      const canonicalRoot = path.resolve(await realpath(rootPath));
      const canonicalEntry = path.resolve(await realpath(skill.entryPath));
      if (!isPathInsideRoot(canonicalRoot, canonicalEntry)) {
        throw new Error("Skill entry path resolves outside its workspace root.");
      }
      return {
        configurationId,
        kind,
        protectedPath: "SKILL.md",
        rootPath: canonicalRoot,
      };
    }

    const server = configuration.mcpServers.find((candidate) => candidate.id === configurationId);
    if (server === undefined) throw new Error("MCP server is not registered in this application.");
    await this.ensureMcpWorkspace(server);
    const rootPath = path.resolve(this.managedMcpWorkspacesPath, server.id);
    return {
      configurationId,
      kind,
      protectedPath: "mcp.json",
      rootPath: path.resolve(await realpath(rootPath)),
    };
  }

  private async ensureMcpWorkspace(server: McpServerConfiguration): Promise<void> {
    const rootPath = resolvePathWithinRoot(
      this.managedMcpWorkspacesPath,
      server.id,
      { outsideRoot: "MCP workspace resolves outside the managed workspace root." },
    );
    await mkdir(rootPath, { recursive: true });
    const documentPath = path.join(rootPath, "mcp.json");
    if (!existsSync(documentPath)) await this.writeMcpDocument(server);
  }

  private async writeMcpDocument(server: McpServerConfiguration): Promise<void> {
    const rootPath = resolvePathWithinRoot(
      this.managedMcpWorkspacesPath,
      server.id,
      { outsideRoot: "MCP workspace resolves outside the managed workspace root." },
    );
    await mkdir(rootPath, { recursive: true });
    const documentPath = path.join(rootPath, "mcp.json");
    if (existsSync(documentPath) && (await lstat(documentPath)).isSymbolicLink()) {
      throw new Error("MCP configuration document cannot be a symbolic link.");
    }
    await this.writeAtomically(documentPath, `${JSON.stringify(server, null, 2)}\n`);
  }

  private async saveMcpDocument(configurationId: string, content: string): Promise<string> {
    let parsed: McpServerConfiguration;
    try {
      parsed = mcpServerConfigurationSchema.parse(JSON.parse(content));
    } catch {
      throw new Error("mcp.json 必须是有效的 MCP Server JSON 配置。");
    }
    if (parsed.id !== configurationId) {
      throw new Error("mcp.json 中的 id 不能改变当前 MCP Server。请先在配置表单中修改 ID。 ");
    }

    const current = this.integrationConfiguration.getConfiguration();
    if (!current.mcpServers.some((server) => server.id === configurationId)) {
      throw new Error("MCP server is no longer registered in this application.");
    }
    const next = {
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === configurationId ? parsed : server,
      ),
    };
    this.integrationConfiguration.saveConfiguration(next);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
    await this.writeMcpDocument(parsed);
    return formatted;
  }

  private async resolveExistingPath(workspace: ResolvedWorkspace, relativePath: string): Promise<string> {
    return resolveExistingPathWithinRoot(
      workspace.rootPath,
      relativePath,
      {
        outsideRoot: "Configuration workspace path is outside its root.",
        resolvedOutsideRoot: "Configuration workspace path resolves outside its root.",
      },
    );
  }

  private async resolveWritablePath(workspace: ResolvedWorkspace, relativePath: string): Promise<string> {
    return resolveWritablePathWithinRoot(
      workspace.rootPath,
      relativePath,
      {
        outsideRoot: "Configuration workspace path is outside its root.",
        resolvedOutsideRoot: "Configuration workspace path resolves outside its root.",
        symbolicLink: "Symbolic links cannot be edited through a configuration workspace.",
      },
    );
  }

  private async writeAtomically(filePath: string, content: string): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      if (existsSync(temporaryPath)) await rm(temporaryPath, { force: true });
    }
  }

  private toTextFile(
    workspace: ResolvedWorkspace,
    relativePath: string,
    content: string,
  ): ConfigurationWorkspaceFile {
    return configurationWorkspaceFileSchema.parse({
      byteLength: Buffer.byteLength(content, "utf8"),
      configurationId: workspace.configurationId,
      content,
      isBinary: false,
      isProtected: isProtectedPath(workspace, relativePath),
      kind: workspace.kind,
      name: path.basename(relativePath),
      path: relativePath,
      truncated: false,
    });
  }
}
