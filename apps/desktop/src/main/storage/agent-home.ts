import { cp, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LEGACY_AGENT_ENTRIES = [
  "agent.sqlite",
  "agent.sqlite-shm",
  "agent.sqlite-wal",
  "application-settings.json",
  "context-compression-settings.json",
  "conversation-files",
  "integration-settings.json",
  "langgraph-checkpoints.sqlite",
  "langgraph-checkpoints.sqlite-shm",
  "langgraph-checkpoints.sqlite-wal",
  "mcp",
  "model-catalog.json",
  "model-credentials.json",
  "plugins",
  "skills",
  "terminal-settings.json",
] as const;

export type AgentHomePaths = {
  agentDatabasePath: string;
  applicationSettingsPath: string;
  contextCompressionSettingsPath: string;
  conversationFilesPath: string;
  conversationsPath: string;
  credentialsPath: string;
  graphCheckpointPath: string;
  integrationSettingsPath: string;
  mcpPath: string;
  modelCatalogPath: string;
  pluginsPath: string;
  rootPath: string;
  skillsPath: string;
  terminalSettingsPath: string;
};

export type AgentHomeInitialization = {
  migratedEntries: string[];
  paths: AgentHomePaths;
};

export function resolveAgentHomePath(input: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
} = {}): string {
  const configuredPath = input.environment?.AGENT_HOME?.trim();
  if (configuredPath !== undefined && configuredPath.length > 0) {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error("AGENT_HOME 必须是绝对路径。");
    }
    return path.resolve(configuredPath);
  }
  return path.join(path.resolve(input.homeDirectory ?? os.homedir()), ".agent");
}

export function createAgentHomePaths(rootPath: string): AgentHomePaths {
  const resolvedRootPath = path.resolve(rootPath);
  return {
    agentDatabasePath: path.join(resolvedRootPath, "agent.sqlite"),
    applicationSettingsPath: path.join(resolvedRootPath, "application-settings.json"),
    contextCompressionSettingsPath: path.join(resolvedRootPath, "context-compression-settings.json"),
    conversationFilesPath: path.join(resolvedRootPath, "conversation-files"),
    conversationsPath: path.join(resolvedRootPath, "conversations"),
    credentialsPath: path.join(resolvedRootPath, "model-credentials.json"),
    graphCheckpointPath: path.join(resolvedRootPath, "langgraph-checkpoints.sqlite"),
    integrationSettingsPath: path.join(resolvedRootPath, "integration-settings.json"),
    mcpPath: path.join(resolvedRootPath, "mcp"),
    modelCatalogPath: path.join(resolvedRootPath, "model-catalog.json"),
    pluginsPath: path.join(resolvedRootPath, "plugins"),
    rootPath: resolvedRootPath,
    skillsPath: path.join(resolvedRootPath, "skills"),
    terminalSettingsPath: path.join(resolvedRootPath, "terminal-settings.json"),
  };
}

export async function initializeAgentHome(input: {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  legacyRootPath: string;
}): Promise<AgentHomeInitialization> {
  const paths = createAgentHomePaths(resolveAgentHomePath(input));
  const legacyRootPath = path.resolve(input.legacyRootPath);
  await mkdir(paths.rootPath, { recursive: true, mode: 0o700 });

  if (legacyRootPath === paths.rootPath) return { migratedEntries: [], paths };

  const migratedEntries: string[] = [];
  for (const entry of LEGACY_AGENT_ENTRIES) {
    const sourcePath = path.join(legacyRootPath, entry);
    const targetPath = path.join(paths.rootPath, entry);
    if (await pathExists(targetPath) || !await pathExists(sourcePath)) continue;
    await cp(sourcePath, targetPath, { dereference: false, recursive: true });
    migratedEntries.push(entry);
  }
  return { migratedEntries, paths };
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
