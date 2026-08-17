import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  readJsonConfiguration,
  writeJsonConfiguration,
} from "./json-configuration-file.js";

const temporaryDirectories: string[] = [];
const schema = z.object({ value: z.string() }).strict();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

async function createConfigurationPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-json-config-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "configuration.json");
}

describe("JSON configuration file primitives", () => {
  it("returns a cloned default and validates persisted JSON", async () => {
    const configurationPath = await createConfigurationPath();
    const defaultValue = { value: "default" };
    const first = readJsonConfiguration(configurationPath, schema, defaultValue);
    first.value = "changed";
    expect(readJsonConfiguration(configurationPath, schema, defaultValue)).toEqual(defaultValue);

    writeJsonConfiguration(configurationPath, schema, { value: "saved" });
    expect(readJsonConfiguration(configurationPath, schema, defaultValue)).toEqual({ value: "saved" });
  });

  it("adds file context for malformed JSON and rejects schema failures", async () => {
    const configurationPath = await createConfigurationPath();
    await writeFile(configurationPath, "{broken", "utf8");
    expect(() => readJsonConfiguration(configurationPath, schema, { value: "default" }))
      .toThrow(new RegExp(path.basename(configurationPath)));

    await writeFile(configurationPath, JSON.stringify({ value: 1 }), "utf8");
    expect(() => readJsonConfiguration(configurationPath, schema, { value: "default" }))
      .toThrow(/invalid/i);
  });

  it("uses unique temporary files for concurrent saves and leaves no artifacts", async () => {
    const configurationPath = await createConfigurationPath();
    await Promise.all([
      Promise.resolve().then(() => writeJsonConfiguration(configurationPath, schema, { value: "one" })),
      Promise.resolve().then(() => writeJsonConfiguration(configurationPath, schema, { value: "two" })),
    ]);
    expect(await readFile(configurationPath, "utf8")).toMatch(/"value": "(?:one|two)"/);
    expect((await readdir(path.dirname(configurationPath))).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("cleans the temporary file when the target cannot be renamed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-json-config-failure-"));
    temporaryDirectories.push(directory);
    const targetDirectory = path.join(directory, "target");
    await mkdir(targetDirectory);
    expect(() => writeJsonConfiguration(targetDirectory, schema, { value: "failed" })).toThrow();
    expect((await readdir(directory)).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });
});
