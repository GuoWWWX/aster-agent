import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ARCHIVED_CONVERSATION_RETENTION_DAYS,
  conversationRunEventSchema,
  IPC_CHANNELS,
} from "@agent/protocol";

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
import { PluginCatalog } from "../plugins/plugin-catalog.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { initializeAgentHome } from "../storage/agent-home.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ConversationDeletionService } from "../storage/conversation-deletion-service.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { NodeSqliteCheckpointSaver } from "../storage/node-sqlite-checkpoint-saver.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import { ContextCompressionConfigurationStore } from "../settings/context-compression-configuration-store.js";
import { BrowserConfigurationStore } from "../settings/browser-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { ConfigurationWorkspaceStore } from "../settings/configuration-workspace-store.js";
import { TerminalConfigurationStore } from "../settings/terminal-configuration-store.js";
import { TeamWorkItemRuntime } from "../teams/team-work-item-runtime.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { GitReviewReader } from "../tools/git-review-reader.js";
import { TerminalSessionController } from "../tools/terminal-session-controller.js";
import { WorkspaceTerminalTabController } from "../tools/workspace-terminal-tab-controller.js";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";
import { BrowserToolPlugin } from "../plugins/browser-tool-plugin.js";
import { createMainWindow } from "../windows/main-window.js";
import { ManagedBrowserController } from "../windows/managed-browser-controller.js";

type DesktopServices = {
  agentRuntime: AgentRuntime;
  applicationSettings: ApplicationSettingsStore;
  browserConfiguration: BrowserConfigurationStore;
  attachments: ConversationAttachmentStore;
  conversationDeletion: ConversationDeletionService;
  conversationLifecycle: ConversationLifecycleService;
  modelCatalog: ModelCatalogStore;
  pluginCatalog: PluginCatalog;
  credentials: ModelCredentialStore;
  database: AgentDatabase;
  integrationConfiguration: IntegrationConfigurationStore;
  contextCompression: ContextCompressionConfigurationStore;
  graphCheckpointer: NodeSqliteCheckpointSaver;
  gitReview: GitReviewReader;
  configurationWorkspaces: ConfigurationWorkspaceStore;
  skillDocuments: SkillDocumentStore;
  skillRuntime: SkillRuntime;
  terminalConfiguration: TerminalConfigurationStore;
  teamWorkItems: TeamWorkItemRuntime;
  terminalSessions: TerminalSessionController;
  workspaceTerminalTabs: WorkspaceTerminalTabController;
  workspaceBrowserTabs: WorkspaceBrowserTabController;
  managedBrowser: ManagedBrowserController;
  projectRegistry: ProjectRegistry;
  threadLogLegacyImporter: ThreadLogLegacyImporter;
  tools: ProjectToolRegistry;
};

let mainWindow: BrowserWindow | undefined;
let disposeIpcHandlers: (() => void) | undefined;
let services: DesktopServices | undefined;
let archivedConversationCleanupTimer: ReturnType<typeof setInterval> | undefined;

const ARCHIVED_CONVERSATION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function parseLocalEnvironmentFile(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  const names = new Set([
    "AGENT_MODEL_BASE_URL",
    "AGENT_MODEL_API_KEY",
    "AGENT_MODEL_ID",
    "AGENT_HOME",
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
  const agentHome = await initializeAgentHome({
    environment: process.env,
    legacyRootPath: app.getPath("userData"),
    migrateLegacy: process.env.AGENT_HOME_SKIP_LEGACY_MIGRATION !== "1",
  });
  const database = new AgentDatabase(agentHome.paths.agentDatabasePath);
  const pluginCatalog = new PluginCatalog(database, agentHome.paths.pluginsPath);
  await pluginCatalog.synchronize();
  const graphCheckpointer = new NodeSqliteCheckpointSaver(
    agentHome.paths.graphCheckpointPath,
  );
  const credentials = new ModelCredentialStore(
    agentHome.paths.credentialsPath,
  );
  credentials.importFromEnvironment();
  const modelCatalog = new ModelCatalogStore(
    agentHome.paths.modelCatalogPath,
  );
  modelCatalog.ensureFile();
  const projectRegistry = new ProjectRegistry(database);
  const attachments = new ConversationAttachmentStore(
    database,
    projectRegistry,
    agentHome.paths.conversationFilesPath,
  );
  const threadLog = new ThreadLog(agentHome.paths.conversationsPath);
  const conversationDeletion = new ConversationDeletionService(
    database,
    attachments,
    projectRegistry,
    graphCheckpointer,
    threadLog,
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
    agentHome.paths.integrationSettingsPath,
  );
  const applicationSettings = new ApplicationSettingsStore(
    agentHome.paths.applicationSettingsPath,
  );
  applicationSettings.ensureFile();
  database.syncTeamDirectory(applicationSettings.getConfiguration().agentDirectory);
  applicationSettings.onChanged((configuration) => {
    database.syncTeamDirectory(configuration.agentDirectory);
  });
  const contextCompression = new ContextCompressionConfigurationStore(
    agentHome.paths.contextCompressionSettingsPath,
  );
  contextCompression.ensureFile();
  const skillDocuments = new SkillDocumentStore(
    integrationConfiguration,
    agentHome.paths.skillsPath,
  );
  skillDocuments.discoverDocuments();
  const skillRuntime = new SkillRuntime(skillDocuments, integrationConfiguration);
  const configurationWorkspaces = new ConfigurationWorkspaceStore(
    integrationConfiguration,
    agentHome.paths.mcpPath,
  );
  await configurationWorkspaces.synchronizeMcpDocuments(
    integrationConfiguration.getConfiguration(),
  );
  const terminalConfiguration = new TerminalConfigurationStore(
    agentHome.paths.terminalSettingsPath,
  );
  const browserConfiguration = new BrowserConfigurationStore(
    agentHome.paths.browserSettingsPath,
  );
  const tools = new ProjectToolRegistry(projectRegistry, terminalConfiguration);
  const gitReview = new GitReviewReader(projectRegistry);
  const terminalSessions = new TerminalSessionController(projectRegistry, terminalConfiguration);
  const workspaceTerminalTabs = new WorkspaceTerminalTabController();
  const workspaceBrowserTabs = new WorkspaceBrowserTabController();
  const managedBrowser = new ManagedBrowserController(
    () => mainWindow,
    browserConfiguration,
  );
  const browserToolPlugin = new BrowserToolPlugin(managedBrowser, workspaceBrowserTabs);
  const eventProjector = new EventProjector(
    database,
    threadLog,
    (attachment) => attachments.resolveThreadLogPaths(attachment),
  );
  const conversationLifecycle = new ConversationLifecycleService(
    database,
    threadLog,
    eventProjector,
    credentials,
  );
  const threadLogLegacyImporter = new ThreadLogLegacyImporter(
    database,
    threadLog,
    eventProjector,
  );
  try {
    threadLogLegacyImporter.recoverUnreadableConversationLogs();
    threadLogLegacyImporter.importMissingConversationLogs();
    eventProjector.projectAllConversationLogs();
    database.interruptRecoveredThreadLogRuns();
    const inconsistent = eventProjector
      .verifyAllConversationLogs()
      .find((result) => !result.isConsistent);
    if (inconsistent !== undefined) {
      throw new Error("ThreadLog event index is inconsistent with its JSONL source.");
    }
  } catch (error) {
    reportMainError(
      toMainAgentError(error, { operation: "thread_log.startup_projection" }),
      error,
    );
  }

  const agentRuntime = new AgentRuntime(
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
    undefined,
    applicationSettings,
    threadLog,
    eventProjector,
    threadLogLegacyImporter,
    pluginCatalog,
    workspaceTerminalTabs,
    terminalSessions,
    browserToolPlugin,
  );
  const teamWorkItems = new TeamWorkItemRuntime(
    database,
    conversationLifecycle,
    agentRuntime,
    credentials,
    projectRegistry,
    { getConfiguration: () => applicationSettings.getConfiguration().agentDirectory },
  );
  agentRuntime.setTeamWorkItemDispatcher(teamWorkItems);
  applicationSettings.onChanged(() => {
    teamWorkItems.resumeQueued(sendConversationRunEvent);
  });
  database.blockInterruptedTeamWorkItems();

  return {
    agentRuntime,
    applicationSettings,
    browserConfiguration,
    attachments,
    conversationDeletion,
    conversationLifecycle,
    credentials,
    contextCompression,
    graphCheckpointer,
    gitReview,
    configurationWorkspaces,
    modelCatalog,
    pluginCatalog,
    database,
    integrationConfiguration,
    projectRegistry,
    threadLogLegacyImporter,
    skillDocuments,
    skillRuntime,
    terminalConfiguration,
    teamWorkItems,
    terminalSessions,
    workspaceTerminalTabs,
    workspaceBrowserTabs,
    managedBrowser,
    tools,
  };
}

function getServices(): DesktopServices {
  if (services === undefined) {
    throw new Error("Desktop services were not initialized.");
  }
  return services;
}

function sendConversationRunEvent(event: unknown): void {
  const window = mainWindow;
  if (window === undefined || window.isDestroyed()) return;
  window.webContents.send(
    IPC_CHANNELS.conversationRunEvent,
    conversationRunEventSchema.parse(event),
  );
}

async function openMainWindow(): Promise<void> {
  const window = createMainWindow();
  let rendererRecoveryAttempted = false;
  mainWindow = window;
  disposeIpcHandlers = registerMainIpcHandlers(() => mainWindow, getServices(), {
    resumePendingMessages: process.env.AGENT_SKIP_PENDING_RUN_RESUMPTION !== "1",
  });
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
      services?.managedBrowser.dispose();
      services?.terminalSessions.dispose();
      mainWindow = undefined;
    }
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    services?.teamWorkItems.resumeQueued(sendConversationRunEvent);
  });
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

function focusMainWindow(): void {
  const window = mainWindow;
  if (window === undefined || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    focusMainWindow();
  });
}

async function bootstrap(): Promise<void> {
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }
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
    services?.managedBrowser.dispose();
    services?.terminalSessions.dispose();
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
