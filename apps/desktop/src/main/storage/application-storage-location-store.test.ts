import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationStorageLocationStore } from "./application-storage-location-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {
      force: true,
      recursive: true,
    })),
  );
});

async function createFixture(environment: NodeJS.ProcessEnv = {}): Promise<{
  configurationPath: string;
  homeDirectory: string;
  store: ApplicationStorageLocationStore;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aster-storage-location-"));
  temporaryDirectories.push(root);
  const homeDirectory = path.join(root, "home");
  const configurationPath = path.join(root, "bootstrap", "storage-location.json");
  await mkdir(homeDirectory, { recursive: true });
  return {
    configurationPath,
    homeDirectory,
    store: new ApplicationStorageLocationStore({
      configurationPath,
      environment,
      homeDirectory,
    }),
  };
}

describe("ApplicationStorageLocationStore", () => {
  it("uses the user home .aster directory by default", async () => {
    const { homeDirectory, store } = await createFixture();

    expect(store.getLocation()).toEqual({
      activePath: path.join(homeDirectory, ".aster"),
      canChange: true,
      configuredPath: path.join(homeDirectory, ".aster"),
      configurationError: false,
      defaultPath: path.join(homeDirectory, ".aster"),
      restartRequired: false,
      source: "default",
    });
  });

  it("persists a custom directory and reports that restart is required", async () => {
    const { configurationPath, store } = await createFixture();
    const customPath = path.join(path.dirname(configurationPath), "custom-data");
    await mkdir(customPath, { recursive: true });

    expect(store.selectLocation(customPath)).toMatchObject({
      activePath: store.getStartupPath(),
      configuredPath: customPath,
      restartRequired: true,
      source: "custom",
    });
    await expect(readFile(configurationPath, "utf8")).resolves.toContain(customPath.replaceAll("\\", "\\\\"));
  });

  it("restores the default directory without deleting the custom directory", async () => {
    const { configurationPath, homeDirectory, store } = await createFixture();
    const customPath = path.join(path.dirname(configurationPath), "custom-data");
    await mkdir(customPath, { recursive: true });
    store.selectLocation(customPath);

    expect(store.resetLocation()).toMatchObject({
      configuredPath: path.join(homeDirectory, ".aster"),
      restartRequired: false,
      source: "default",
    });
    await expect(readFile(configurationPath, "utf8")).resolves.toContain('"customPath": null');
  });

  it("keeps an environment override authoritative", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aster-storage-environment-"));
    temporaryDirectories.push(root);
    const environmentPath = path.join(root, "environment-data");
    const { store } = await createFixture({ ASTER_HOME: environmentPath });

    expect(store.getLocation()).toMatchObject({
      activePath: environmentPath,
      canChange: false,
      configuredPath: environmentPath,
      source: "environment",
    });
    expect(() => store.resetLocation()).toThrow("环境变量控制");
  });

  it("falls back to the default directory when the pointer file is invalid", async () => {
    const fixture = await createFixture();
    await mkdir(path.dirname(fixture.configurationPath), { recursive: true });
    await writeFile(fixture.configurationPath, "not json", "utf8");
    const store = new ApplicationStorageLocationStore({
      configurationPath: fixture.configurationPath,
      environment: {},
      homeDirectory: fixture.homeDirectory,
    });

    expect(store.getLocation()).toMatchObject({
      configurationError: true,
      configuredPath: path.join(fixture.homeDirectory, ".aster"),
      source: "default",
    });
  });

  it("falls back safely when a previously selected directory is unavailable", async () => {
    const fixture = await createFixture();
    await mkdir(path.dirname(fixture.configurationPath), { recursive: true });
    await writeFile(fixture.configurationPath, JSON.stringify({
      customPath: path.join(path.dirname(fixture.configurationPath), "missing"),
      version: 1,
    }), "utf8");
    const store = new ApplicationStorageLocationStore({
      configurationPath: fixture.configurationPath,
      environment: {},
      homeDirectory: fixture.homeDirectory,
    });

    expect(store.getLocation()).toMatchObject({
      configurationError: true,
      configuredPath: path.join(fixture.homeDirectory, ".aster"),
      restartRequired: false,
      source: "default",
    });
  });
});
