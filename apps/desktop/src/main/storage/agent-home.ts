import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LEGACY_AGENT_ENTRIES = [
  { source: "db.sqlite", target: "db.sqlite" },
  { source: "db.sqlite-shm", target: "db.sqlite-shm" },
  { source: "db.sqlite-wal", target: "db.sqlite-wal" },
  { source: "agent.sqlite", target: "db.sqlite" },
  { source: "agent.sqlite-shm", target: "db.sqlite-shm" },
  { source: "agent.sqlite-wal", target: "db.sqlite-wal" },
  { source: "application-settings.json", target: "application-settings.json" },
  { source: "browser-settings.json", target: "browser-settings.json" },
  { source: "context-compression-settings.json", target: "context-compression-settings.json" },
  { source: "conversation-files", target: "attachments" },
  { source: "integration-settings.json", target: "integration-settings.json" },
  { source: "mcp", target: "mcp" },
  { source: "model-catalog.json", target: "model-catalog.json" },
  { source: "model-credentials.json", target: "model-credentials.json" },
  { source: "plugins", target: "plugins" },
  { source: "skills", target: "skills" },
  { source: "terminal-settings.json", target: "terminal-settings.json" },
] as const;

export type AgentHomePaths = {
  applicationSettingsPath: string;
  browserSettingsPath: string;
  contextCompressionSettingsPath: string;
  conversationFilesPath: string;
  conversationsPath: string;
  credentialsPath: string;
  databasePath: string;
  integrationSettingsPath: string;
  mcpPath: string;
  modelCatalogPath: string;
  pluginsPath: string;
  rootPath: string;
  settingsPath: string;
  skillsPath: string;
  terminalSettingsPath: string;
  workspacesPath: string;
};

export type AgentHomeInitialization = {
  legacyCheckpointDatabasePaths: string[];
  legacyConversationFilesPaths: string[];
  migratedEntries: string[];
  paths: AgentHomePaths;
};

export function resolveAgentHomePath(input: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): string {
  const configuredAsterHome = input.environment?.ASTER_HOME?.trim();
  const configuredAgentHome = input.environment?.AGENT_HOME?.trim();
  const configuredPath = configuredAsterHome || configuredAgentHome;
  if (configuredPath !== undefined && configuredPath.length > 0) {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error(`${configuredAsterHome ? "ASTER_HOME" : "AGENT_HOME"} 必须是绝对路径。`);
    }
    return path.resolve(configuredPath);
  }
  return path.join(path.resolve(input.homeDirectory ?? os.homedir()), ".aster");
}

export function initializeElectronUserDataPath(input: {
  environment?: NodeJS.ProcessEnv;
  legacyRootPath: string;
}): string {
  const legacyRootPath = path.resolve(input.legacyRootPath);
  const configuredHome = input.environment?.ASTER_HOME?.trim()
    || input.environment?.AGENT_HOME?.trim();
  if (configuredHome === undefined || configuredHome.length === 0) {
    return legacyRootPath;
  }

  const userDataPath = path.join(
    resolveAgentHomePath(
      input.environment === undefined ? {} : { environment: input.environment },
    ),
    "electron-profile",
  );
  mkdirSync(userDataPath, { recursive: true, mode: 0o700 });

  const sourceLocalStatePath = path.join(legacyRootPath, "Local State");
  const targetLocalStatePath = path.join(userDataPath, "Local State");
  if (!existsSync(targetLocalStatePath) && existsSync(sourceLocalStatePath)) {
    copyFileSync(sourceLocalStatePath, targetLocalStatePath);
    chmodSync(targetLocalStatePath, 0o600);
  }
  return userDataPath;
}

export function createAgentHomePaths(rootPath: string): AgentHomePaths {
  const resolvedRootPath = path.resolve(rootPath);
  return {
    applicationSettingsPath: path.join(resolvedRootPath, "application-settings.json"),
    browserSettingsPath: path.join(resolvedRootPath, "browser-settings.json"),
    contextCompressionSettingsPath: path.join(resolvedRootPath, "context-compression-settings.json"),
    conversationFilesPath: path.join(resolvedRootPath, "attachments"),
    conversationsPath: path.join(resolvedRootPath, "conversations"),
    credentialsPath: path.join(resolvedRootPath, "model-credentials.json"),
    databasePath: path.join(resolvedRootPath, "db.sqlite"),
    integrationSettingsPath: path.join(resolvedRootPath, "integration-settings.json"),
    mcpPath: path.join(resolvedRootPath, "mcp"),
    modelCatalogPath: path.join(resolvedRootPath, "model-catalog.json"),
    pluginsPath: path.join(resolvedRootPath, "plugins"),
    rootPath: resolvedRootPath,
    settingsPath: path.join(resolvedRootPath, "settings.jsonc"),
    skillsPath: path.join(resolvedRootPath, "skills"),
    terminalSettingsPath: path.join(resolvedRootPath, "terminal-settings.json"),
    workspacesPath: path.join(resolvedRootPath, "workspaces"),
  };
}

export async function initializeAgentHome(input: {
  additionalLegacyRootPaths?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  legacyRootPath: string;
  migrateLegacy?: boolean;
}): Promise<AgentHomeInitialization> {
  const paths = createAgentHomePaths(resolveAgentHomePath(input));
  const legacyRootPath = path.resolve(input.legacyRootPath);
  const legacyAgentHomePath = path.join(
    path.resolve(input.homeDirectory ?? os.homedir()),
    ".agent",
  );
  const hasConfiguredHome = (input.environment?.ASTER_HOME?.trim().length ?? 0) > 0
    || (input.environment?.AGENT_HOME?.trim().length ?? 0) > 0;
  const legacyRootPaths = [...new Set([
    ...(hasConfiguredHome ? [] : [legacyAgentHomePath]),
    ...(input.additionalLegacyRootPaths ?? []).map((rootPath) => path.resolve(rootPath)),
    legacyRootPath,
  ])]
    .filter((candidatePath) => candidatePath !== paths.rootPath);
  const migrationRootPaths = [paths.rootPath, ...legacyRootPaths];
  const legacyConversationFilesPaths = migrationRootPaths.map(
    (rootPath) => path.join(rootPath, "conversation-files"),
  );
  const legacyCheckpointDatabasePaths = migrationRootPaths.map(
    (rootPath) => path.join(rootPath, "langgraph-checkpoints.sqlite"),
  );
  await mkdir(paths.rootPath, { recursive: true, mode: 0o700 });

  if (input.migrateLegacy === false) {
    return {
      legacyCheckpointDatabasePaths: [],
      legacyConversationFilesPaths: [],
      migratedEntries: [],
      paths,
    };
  }

  const migratedEntries: string[] = [];
  for (const legacyPath of migrationRootPaths) {
    for (const entry of LEGACY_AGENT_ENTRIES) {
      const sourcePath = path.join(legacyPath, entry.source);
      const targetPath = path.join(paths.rootPath, entry.target);
      if (await pathExists(targetPath) || !await pathExists(sourcePath)) continue;
      await cp(sourcePath, targetPath, { dereference: false, recursive: true });
      migratedEntries.push(entry.source === entry.target
        ? entry.target
        : `${entry.source} -> ${entry.target}`);
    }
  }
  return {
    legacyCheckpointDatabasePaths: await existingPaths(legacyCheckpointDatabasePaths),
    legacyConversationFilesPaths,
    migratedEntries,
    paths,
  };
}

async function existingPaths(candidatePaths: readonly string[]): Promise<string[]> {
  const results = await Promise.all(candidatePaths.map(async (candidatePath) => ({
    candidatePath,
    exists: await pathExists(candidatePath),
  })));
  return results.filter((result) => result.exists).map((result) => result.candidatePath);
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await stat(candidatePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
