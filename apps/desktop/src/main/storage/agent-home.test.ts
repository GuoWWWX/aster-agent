import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("names durable conversation snapshots attachments instead of temp files", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "aster-home-paths-"));
    temporaryDirectories.push(homeDirectory);
    const paths = createAgentHomePaths(homeDirectory);

    expect(paths.conversationFilesPath).toBe(path.join(homeDirectory, "attachments"));
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
    await writeFile(path.join(legacyAgentHomePath, "agent.sqlite"), "database", "utf8");
    await writeFile(legacyAttachmentPath, "image", "utf8");

    const result = await initializeAgentHome({
      environment: {},
      homeDirectory,
      legacyRootPath: path.join(homeDirectory, "legacy-user-data"),
    });

    expect(result.paths.rootPath).toBe(path.join(homeDirectory, ".aster"));
    await expect(readFile(result.paths.agentDatabasePath, "utf8")).resolves.toBe("database");
    await expect(readFile(
      path.join(result.paths.conversationFilesPath, "conversation-1", "attachment.png"),
      "utf8",
    )).resolves.toBe("image");
    expect(result.legacyConversationFilesPaths).toContain(
      path.join(legacyAgentHomePath, "conversation-files"),
    );
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
