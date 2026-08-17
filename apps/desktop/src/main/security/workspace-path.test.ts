import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isPathInsideRoot,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
  resolveWritablePathWithinRoot,
} from "./workspace-path.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

describe("workspace path primitives", () => {
  it("keeps legitimate names beginning with .. inside the root", () => {
    const rootPath = path.join(os.tmpdir(), "agent-path-root");
    expect(isPathInsideRoot(rootPath, path.join(rootPath, "..name", "file.txt"))).toBe(true);
    if (process.platform === "win32") {
      expect(isPathInsideRoot(rootPath.toUpperCase(), path.join(rootPath, "..name", "file.txt"))).toBe(true);
    }
    expect(isPathInsideRoot(rootPath, path.join(rootPath, "..", "outside.txt"))).toBe(false);
    expect(isPathInsideRoot(rootPath, `${rootPath}-sibling`)).toBe(false);
  });

  it("rejects absolute paths and traversal before filesystem access", () => {
    const rootPath = path.join(os.tmpdir(), "agent-path-root");
    expect(() => resolvePathWithinRoot(rootPath, "../outside.txt")).toThrow(/outside .*root/i);
    expect(() => resolvePathWithinRoot(rootPath, path.resolve(os.tmpdir(), "outside.txt"))).toThrow(/outside .*root/i);
  });

  it("rejects existing and writable paths that cross a directory symlink", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-path-"));
    temporaryDirectories.push(rootPath);
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "agent-path-outside-"));
    temporaryDirectories.push(outsidePath);
    await writeFile(path.join(outsidePath, "secret.txt"), "secret", "utf8");
    const linkPath = path.join(rootPath, "linked");
    try {
      await symlink(outsidePath, linkPath, "junction");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toMatch(/EPERM|EACCES/);
      return;
    }

    await expect(resolveExistingPathWithinRoot(rootPath, path.join("linked", "secret.txt")))
      .rejects.toThrow(/outside .*root/i);
    await expect(resolveWritablePathWithinRoot(rootPath, path.join("linked", "new.txt")))
      .rejects.toThrow(/outside .*root/i);
    const fileLinkPath = path.join(rootPath, "linked-file.txt");
    try {
      await symlink(path.join(outsidePath, "secret.txt"), fileLinkPath, "file");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toMatch(/EPERM|EACCES/);
      return;
    }
    await expect(resolveWritablePathWithinRoot(rootPath, "linked-file.txt"))
      .rejects.toThrow(/symbolic link/i);
  });

  it("allows a normal writable child and preserves its unresolved target path", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "agent-path-"));
    temporaryDirectories.push(rootPath);
    await mkdir(path.join(rootPath, "nested"));

    await expect(resolveExistingPathWithinRoot(rootPath, "nested"))
      .resolves.toBe(path.join(rootPath, "nested"));
    await expect(resolveWritablePathWithinRoot(rootPath, "nested/new.txt"))
      .resolves.toBe(path.join(rootPath, "nested", "new.txt"));
  });
});
