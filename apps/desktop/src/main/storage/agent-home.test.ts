import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentHomePaths,
  initializeAgentHome,
  initializeElectronUserDataPath,
  resolveAgentHomePath,
} from "./agent-home.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Agent home", () => {
  it("uses a .aster directory below the current user's home when no home override is set", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-home-user-"));
    temporaryDirectories.push(homeDirectory);

    expect(resolveAgentHomePath({ environment: {}, homeDirectory })).toBe(
      path.join(homeDirectory, ".aster"),
    );
  });

  it("prefers ASTER_HOME while keeping AGENT_HOME as a compatibility alias", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "aster-home-alias-"));
    temporaryDirectories.push(homeDirectory);
    const asterHome = path.join(homeDirectory, "aster");
    const agentHome = path.join(homeDirectory, "agent");

    expect(resolveAgentHomePath({
      environment: { AGENT_HOME: agentHome, ASTER_HOME: asterHome },
      homeDirectory,
    })).toBe(asterHome);
    expect(resolveAgentHomePath({ environment: { AGENT_HOME: agentHome }, homeDirectory }))
      .toBe(agentHome);
  });

  it("uses the selected storage path below environment overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-home-selected-"));
    temporaryDirectories.push(root);
    const selectedPath = path.join(root, "selected");
    const environmentPath = path.join(root, "environment");

    expect(resolveAgentHomePath({
      environment: {},
      homeDirectory: path.join(root, "home"),
      preferredPath: selectedPath,
    })).toBe(selectedPath);
    expect(resolveAgentHomePath({
      environment: { ASTER_HOME: environmentPath },
      homeDirectory: path.join(root, "home"),
      preferredPath: selectedPath,
    })).toBe(environmentPath);
  });

  it("uses the unified database and durable conversation workspace paths", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "aster-home-paths-"));
    temporaryDirectories.push(homeDirectory);
    const paths = createAgentHomePaths(homeDirectory);

    expect(paths.databasePath).toBe(path.join(homeDirectory, "db.sqlite"));
    expect(paths.conversationFilesPath).toBe(path.join(homeDirectory, "attachments"));
    expect(paths.workspacesPath).toBe(path.join(homeDirectory, "workspaces"));
  });

  it("requires an absolute AGENT_HOME path", () => {
    expect(() => resolveAgentHomePath({ environment: { AGENT_HOME: "relative-agent-home" } }))
      .toThrow("AGENT_HOME 必须是绝对路径。");
  });

  it("keeps Electron user data beside an explicitly configured Agent home", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-electron-profile-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    await mkdir(legacyRootPath, { recursive: true });
    await writeFile(path.join(legacyRootPath, "Local State"), "legacy-encryption-state", "utf8");

    const userDataPath = initializeElectronUserDataPath({
      environment: { AGENT_HOME: configuredHomePath },
      legacyRootPath,
    });

    expect(userDataPath).toBe(path.join(configuredHomePath, "electron-profile"));
    await expect(readFile(path.join(userDataPath, "Local State"), "utf8"))
      .resolves.toBe("legacy-encryption-state");
  });

  it("does not replace an existing Electron encryption state on restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-electron-profile-repeat-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    const userDataPath = path.join(configuredHomePath, "electron-profile");
    await mkdir(legacyRootPath, { recursive: true });
    await mkdir(userDataPath, { recursive: true });
    await writeFile(path.join(legacyRootPath, "Local State"), "legacy-encryption-state", "utf8");
    await writeFile(path.join(userDataPath, "Local State"), "current-encryption-state", "utf8");

    initializeElectronUserDataPath({
      environment: { AGENT_HOME: configuredHomePath },
      legacyRootPath,
    });

    await expect(readFile(path.join(userDataPath, "Local State"), "utf8"))
      .resolves.toBe("current-encryption-state");
  });

  it("keeps the normal Electron profile when AGENT_HOME is not explicit", () => {
    const legacyRootPath = path.join(os.tmpdir(), "agent-electron-default");

    expect(initializeElectronUserDataPath({ environment: {}, legacyRootPath }))
      .toBe(path.resolve(legacyRootPath));
  });

  it("uses the configured Agent home and preserves the legacy storage layout during migration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-home-migration-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    await mkdir(legacyRootPath, { recursive: true });
    await writeFile(path.join(legacyRootPath, "application-settings.json"), '{"version":1}', "utf8");

    const result = await initializeAgentHome({
      environment: { AGENT_HOME: configuredHomePath },
      legacyRootPath,
    });

    expect(result.paths).toEqual(createAgentHomePaths(configuredHomePath));
    expect(result.migratedEntries).toEqual(["application-settings.json"]);
    await expect(readFile(result.paths.applicationSettingsPath, "utf8")).resolves.toBe('{"version":1}');
  });

  it("migrates the former .agent conversation-files directory into .aster attachments", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "aster-home-default-migration-"));
    temporaryDirectories.push(homeDirectory);
    const legacyAgentHomePath = path.join(homeDirectory, ".agent");
    const legacyAttachmentPath = path.join(
      legacyAgentHomePath,
      "conversation-files",
      "conversation-1",
      "attachment.png",
    );
    await mkdir(path.dirname(legacyAttachmentPath), { recursive: true });
    const legacyDatabase = new DatabaseSync(path.join(legacyAgentHomePath, "agent.sqlite"));
    legacyDatabase.exec("CREATE TABLE fixture (value TEXT NOT NULL); INSERT INTO fixture VALUES ('database')");
    legacyDatabase.close();
    await writeFile(legacyAttachmentPath, "image", "utf8");

    const result = await initializeAgentHome({
      environment: {},
      homeDirectory,
      legacyRootPath: path.join(homeDirectory, "legacy-user-data"),
    });

    expect(result.paths.rootPath).toBe(path.join(homeDirectory, ".aster"));
    const migratedDatabase = new DatabaseSync(result.paths.databasePath, { readOnly: true });
    expect(migratedDatabase.prepare("SELECT value FROM fixture").get()).toEqual({ value: "database" });
    migratedDatabase.close();
    expect(result.migratedEntries).toContain("agent.sqlite -> db.sqlite");
    await expect(readFile(
      path.join(result.paths.conversationFilesPath, "conversation-1", "attachment.png"),
      "utf8",
    )).resolves.toBe("image");
    expect(result.legacyConversationFilesPaths).toContain(
      path.join(legacyAgentHomePath, "conversation-files"),
    );
  });

  it("does not copy legacy SQLite sidecars beside an existing current database", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-home-sqlite-sidecars-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    await mkdir(legacyRootPath, { recursive: true });
    await mkdir(configuredHomePath, { recursive: true });

    const currentDatabase = new DatabaseSync(path.join(configuredHomePath, "db.sqlite"));
    currentDatabase.exec("CREATE TABLE fixture (value TEXT NOT NULL); INSERT INTO fixture VALUES ('current')");
    currentDatabase.close();
    const legacyDatabase = new DatabaseSync(path.join(legacyRootPath, "agent.sqlite"));
    legacyDatabase.exec("PRAGMA journal_mode = WAL; CREATE TABLE fixture (value TEXT NOT NULL); INSERT INTO fixture VALUES ('legacy')");

    const result = await initializeAgentHome({
      environment: { ASTER_HOME: configuredHomePath },
      legacyRootPath,
    });

    const reopened = new DatabaseSync(result.paths.databasePath, { readOnly: true });
    expect(reopened.prepare("SELECT value FROM fixture").get()).toEqual({ value: "current" });
    reopened.close();
    expect(result.migratedEntries).not.toContain("agent.sqlite -> db.sqlite");
    legacyDatabase.close();
  });

  it("backs up a legacy WAL database into one self-contained current database", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-home-sqlite-backup-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    await mkdir(legacyRootPath, { recursive: true });
    const legacyDatabase = new DatabaseSync(path.join(legacyRootPath, "agent.sqlite"));
    legacyDatabase.exec("PRAGMA journal_mode = WAL; CREATE TABLE fixture (value TEXT NOT NULL); INSERT INTO fixture VALUES ('legacy-wal')");

    const result = await initializeAgentHome({
      environment: { ASTER_HOME: configuredHomePath },
      legacyRootPath,
    });

    const migratedDatabase = new DatabaseSync(result.paths.databasePath, { readOnly: true });
    expect(migratedDatabase.prepare("SELECT value FROM fixture").get()).toEqual({
      value: "legacy-wal",
    });
    migratedDatabase.close();
    legacyDatabase.close();
  });

  it("keeps Electron user data beside a user-selected storage root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-electron-selected-"));
    temporaryDirectories.push(root);
    const selectedPath = path.join(root, "selected");

    expect(initializeElectronUserDataPath({
      environment: {},
      legacyRootPath: path.join(root, "legacy"),
      preferredPath: selectedPath,
    })).toBe(path.join(selectedPath, "electron-profile"));
  });

  it("returns former checkpoint databases for import into db.sqlite", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-home-checkpoint-migration-"));
    temporaryDirectories.push(root);
    const configuredHomePath = path.join(root, "configured");
    const legacyRootPath = path.join(root, "legacy");
    const checkpointPath = path.join(legacyRootPath, "langgraph-checkpoints.sqlite");
    await mkdir(legacyRootPath, { recursive: true });
    await writeFile(checkpointPath, "legacy checkpoint database", "utf8");

    const result = await initializeAgentHome({
      environment: { ASTER_HOME: configuredHomePath },
      legacyRootPath,
    });

    expect(result.legacyCheckpointDatabasePaths).toEqual([checkpointPath]);
    await expect(readFile(path.join(configuredHomePath, "langgraph-checkpoints.sqlite"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates the former scoped-package Electron user data directory", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "aster-home-package-migration-"));
    temporaryDirectories.push(homeDirectory);
    const legacyPackageRoot = path.join(homeDirectory, "@agent", "desktop");
    const legacyAttachmentPath = path.join(
      legacyPackageRoot,
      "conversation-files",
      "conversation-1",
      "attachment.png",
    );
    await mkdir(path.dirname(legacyAttachmentPath), { recursive: true });
    await writeFile(legacyAttachmentPath, "image", "utf8");

    const result = await initializeAgentHome({
      additionalLegacyRootPaths: [legacyPackageRoot],
      environment: {},
      homeDirectory,
      legacyRootPath: path.join(homeDirectory, "Aster"),
    });

    await expect(readFile(
      path.join(result.paths.conversationFilesPath, "conversation-1", "attachment.png"),
      "utf8",
    )).resolves.toBe("image");
    expect(result.legacyConversationFilesPaths).toContain(
      path.join(legacyPackageRoot, "conversation-files"),
    );
  });

  it("does not overwrite an existing Agent home entry during a repeat migration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-home-repeat-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    const paths = createAgentHomePaths(configuredHomePath);
    await mkdir(legacyRootPath, { recursive: true });
    await mkdir(configuredHomePath, { recursive: true });
    await writeFile(path.join(legacyRootPath, "model-catalog.json"), "legacy", "utf8");
    await writeFile(paths.modelCatalogPath, "current", "utf8");

    const result = await initializeAgentHome({
      environment: { AGENT_HOME: configuredHomePath },
      legacyRootPath,
    });

    expect(result.migratedEntries).toEqual([]);
    await expect(readFile(paths.modelCatalogPath, "utf8")).resolves.toBe("current");
  });

  it("can initialize an explicitly isolated Agent home without copying legacy state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-home-isolated-"));
    temporaryDirectories.push(root);
    const legacyRootPath = path.join(root, "legacy");
    const configuredHomePath = path.join(root, "configured");
    await mkdir(legacyRootPath, { recursive: true });
    await writeFile(path.join(legacyRootPath, "model-credentials.json"), "legacy", "utf8");

    const result = await initializeAgentHome({
      environment: { AGENT_HOME: configuredHomePath },
      legacyRootPath,
      migrateLegacy: false,
    });

    expect(result.migratedEntries).toEqual([]);
    await expect(readFile(result.paths.credentialsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
