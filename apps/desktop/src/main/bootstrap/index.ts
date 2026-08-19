import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ARCHIVED_CONVERSATION_RETENTION_DAYS } from "@agent/protocol";

import { AgentRuntime } from "../agent/agent-runtime.js";
import { SkillRuntime } from "../agent/skill-runtime.js";
import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import { registerMainIpcHandlers } from "../ipc/register-main-ipc.js";
import { ModelCatalogStore } from "../model/model-catalog-store.js";
import { ModelCredentialStore } from "../model/model-credential-store.js";
import {
  applyRendererSecurityPolicy,
  loadRenderer
} from "../security/renderer-policy.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ConversationDeletionService } from "../storage/conversation-deletion-service.js";
import { NodeSqliteCheckpointSaver } from "../storage/node-sqlite-checkpoint-saver.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import { ContextCompressionConfigurationStore } from "../settings/context-compression-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { ConfigurationWorkspaceStore } from "../settings/configuration-workspace-store.js";
import { TerminalConfigurationStore } from "../settings/terminal-configuration-store.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { createMainWindow } from "../windows/main-window.js";

type DesktopServices = {
  agentRuntime: AgentRuntime;
  applicationSettings: ApplicationSettingsStore;
  attachments: ConversationAttachmentStore;
  conversationDeletion: ConversationDeletionService;
  modelCatalog: ModelCatalogStore;
  credentials: ModelCredentialStore;
  database: AgentDatabase;
  integrationConfiguration: IntegrationConfigurationStore;
  contextCompression: ContextCompressionConfigurationStore;
  graphCheckpointer: NodeSqliteCheckpointSaver;
  configurationWorkspaces: ConfigurationWorkspaceStore;
  skillDocuments: SkillDocumentStore;
  skillRuntime: SkillRuntime;
  terminalConfiguration: TerminalConfigurationStore;
  projectRegistry: ProjectRegistry;
};

let mainWindow: BrowserWindow | undefined;
let disposeIpcHandlers: (() => void) | undefined;
let services: DesktopServices | undefined;
let archivedConversationCleanupTimer: ReturnType<typeof setInterval> | undefined;

const ARCHIVED_CONVERSATION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

function parseLocalEnvironmentFile(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  const names = new Set([
    "AGENT_MODEL_BASE_URL",
    "AGENT_MODEL_API_KEY",
    "AGENT_MODEL_ID"
  ]);

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
    );
    if (match === null || !names.has(match[1] ?? "")) continue;
    const name = match[1];
    if (name === undefined) continue;
    let value = match[2] ?? "";
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(name, value);
  }

  return entries;
}

function findLocalEnvironmentFile(): string | undefined {
  const candidates = new Set<string>();
  for (const startingDirectory of [process.cwd(), app.getAppPath()]) {
    let directory = path.resolve(startingDirectory);
    for (let depth = 0; depth < 3; depth += 1) {
      candidates.add(path.join(directory, ".env.local"));
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...candidates].find((candidate) => existsSync(candidate));
}

function loadLocalEnvironment(): void {
  const environmentPath = findLocalEnvironmentFile();
  if (environmentPath === undefined) return;

  for (const [name, value] of parseLocalEnvironmentFile(
    readFileSync(environmentPath, "utf8")
  )) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

async function initializeServices(): Promise<DesktopServices> {
  loadLocalEnvironment();
  const database = new AgentDatabase(path.join(app.getPath("userData"), "agent.sqlite"));
  const graphCheckpointer = new NodeSqliteCheckpointSaver(
    path.join(app.getPath("userData"), "langgraph-checkpoints.sqlite"),
  );
  const credentials = new ModelCredentialStore(
    path.join(app.getPath("userData"), "model-credentials.json")
  );
  credentials.importFromEnvironment();
  const modelCatalog = new ModelCatalogStore(
    path.join(app.getPath("userData"), "model-catalog.json")
  );
  modelCatalog.ensureFile();
  const projectRegistry = new ProjectRegistry(database);
  const attachments = new ConversationAttachmentStore(
    database,
    projectRegistry,
    path.join(app.getPath("userData"), "conversation-files")
  );
  const conversationDeletion = new ConversationDeletionService(
    database,
    attachments,
    projectRegistry,
    graphCheckpointer,
  );
  await conversationDeletion.resumeIncompleteTasks();
  await conversationDeletion.deleteExpiredArchivedConversations(
    new Date(
      Date.now() - ARCHIVED_CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString(),
  );
  for (const workspace of database.listConversationWorkspaces()) {
    try {
      await projectRegistry.mountConversationWorkspace(
        workspace.conversationId,
        workspace.rootPath
      );
    } catch (error) {
      console.warn(
        `Conversation workspace could not be restored: ${workspace.rootPath}`,
        error
      );
    }
  }
  const integrationConfiguration = new IntegrationConfigurationStore(
    path.join(app.getPath("userData"), "integration-settings.json")
  );
  const applicationSettings = new ApplicationSettingsStore(
    path.join(app.getPath("userData"), "application-settings.json"),
  );
  applicationSettings.ensureFile();
  const contextCompression = new ContextCompressionConfigurationStore(
    path.join(app.getPath("userData"), "context-compression-settings.json")
  );
  contextCompression.ensureFile();
  const skillDocuments = new SkillDocumentStore(
    integrationConfiguration,
    path.join(app.getPath("userData"), "skills"),
  );
  skillDocuments.discoverDocuments();
  const skillRuntime = new SkillRuntime(skillDocuments, integrationConfiguration);
  const configurationWorkspaces = new ConfigurationWorkspaceStore(
    integrationConfiguration,
    path.join(app.getPath("userData"), "mcp"),
  );
  await configurationWorkspaces.synchronizeMcpDocuments(
    integrationConfiguration.getConfiguration(),
  );
  const terminalConfiguration = new TerminalConfigurationStore(
    path.join(app.getPath("userData"), "terminal-settings.json"),
  );
  const tools = new ProjectToolRegistry(projectRegistry, terminalConfiguration);

  return {
    agentRuntime: new AgentRuntime(
      database,
      credentials,
      projectRegistry,
      tools,
      undefined,
      undefined,
      contextCompression,
      null,
      attachments,
      {
        getConfiguration: () => applicationSettings.getConfiguration().agentDirectory,
      },
      skillRuntime,
      graphCheckpointer,
    ),
    applicationSettings,
    attachments,
    conversationDeletion,
    credentials,
    contextCompression,
    graphCheckpointer,
    configurationWorkspaces,
    modelCatalog,
    database,
    integrationConfiguration,
    projectRegistry,
    skillDocuments,
    skillRuntime,
    terminalConfiguration,
  };
}

function getServices(): DesktopServices {
  if (services === undefined) {
    throw new Error("Desktop services were not initialized.");
  }
  return services;
}

async function openMainWindow(): Promise<void> {
  const window = createMainWindow();
  let rendererRecoveryAttempted = false;
  mainWindow = window;
  disposeIpcHandlers = registerMainIpcHandlers(() => mainWindow, getServices());
  const rendererTarget = applyRendererSecurityPolicy(window);

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    reportUnhandledError(error, "electron.preload", { preloadPath });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    reportUnhandledError(
      new Error(`Renderer process exited: ${details.reason} (${details.exitCode}).`),
      "electron.renderer",
      { exitCode: details.exitCode, reason: details.reason },
    );
    if (
      details.reason !== "clean-exit" &&
      !rendererRecoveryAttempted &&
      !window.isDestroyed()
    ) {
      rendererRecoveryAttempted = true;
      void loadRenderer(window, rendererTarget).catch(reportStartupError);
    }
  });

  window.on("unresponsive", () => {
    reportUnhandledError(
      new Error("The main renderer window became unresponsive."),
      "electron.renderer_unresponsive",
    );
  });

  window.once("closed", () => {
    if (mainWindow === window) {
      disposeIpcHandlers?.();
      disposeIpcHandlers = undefined;
      mainWindow = undefined;
    }
  });

  window.once("ready-to-show", () => window.show());
  await loadRenderer(window, rendererTarget);
}

function reportUnhandledError(
  reason: unknown,
  operation: string,
  details: Record<string, unknown> = {},
): void {
  const error = toMainAgentError(reason, { operation });
  reportMainError(
    { ...error, details: { ...error.details, ...details } },
    reason,
  );
}

function reportStartupError(error: unknown): void {
  reportUnhandledError(error, "electron.startup");
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId("com.agent.workbench");
  services = await initializeServices();
  archivedConversationCleanupTimer = setInterval(() => {
    const currentServices = services;
    if (currentServices === undefined) return;
    try {
      const cutoff = new Date(
        Date.now() - ARCHIVED_CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
      ).toISOString();
      void currentServices.conversationDeletion.resumeIncompleteTasks()
        .then(() => currentServices.conversationDeletion.deleteExpiredArchivedConversations(cutoff))
        .catch((error) => {
          console.error("Expired archived conversations could not be deleted.", error);
        });
    } catch (error) {
      console.error("Expired archived conversations could not be deleted.", error);
    }
  }, ARCHIVED_CONVERSATION_CLEANUP_INTERVAL_MS);
  archivedConversationCleanupTimer.unref();

  await openMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void openMainWindow().catch(reportStartupError);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.once("before-quit", () => {
    if (archivedConversationCleanupTimer !== undefined) {
      clearInterval(archivedConversationCleanupTimer);
      archivedConversationCleanupTimer = undefined;
    }
    services?.graphCheckpointer.close();
    services?.database.close();
    services = undefined;
  });
}

process.on("uncaughtException", (reason) => {
  reportUnhandledError(reason, "process.uncaught_exception");
});
process.on("unhandledRejection", (reason) => {
  reportUnhandledError(reason, "process.unhandled_rejection");
});

void bootstrap().catch(reportStartupError);
