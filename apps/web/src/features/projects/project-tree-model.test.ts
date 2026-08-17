import { describe, expect, it } from "vitest";

import type { ProjectEntry } from "@agent/protocol";

import { reorderProjectPaths, sortProjectEntries } from "./project-tree-model.js";

describe("sortProjectEntries", () => {
  const entries = [
    { kind: "file" as const, name: "a.txt", path: "a.txt" },
    { kind: "directory" as const, name: "alpha", path: "alpha" },
    { kind: "file" as const, name: "z.txt", path: "z.txt" },
    { kind: "directory" as const, name: "zeta", path: "zeta" },
  ];

  it("keeps directories before files in both name directions", () => {
    expect(sortProjectEntries(entries, "name-ascending").map((entry) => entry.name)).toEqual([
      "alpha", "zeta", "a.txt", "z.txt",
    ]);
    expect(sortProjectEntries(entries, "name-descending").map((entry) => entry.name)).toEqual([
      "zeta", "alpha", "z.txt", "a.txt",
    ]);
  });

  it("sorts entries by modification time while keeping directories first", () => {
    const modifiedTimes = [
      "2026-08-03T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "2026-08-04T00:00:00.000Z",
    ];
    const timedEntries: ProjectEntry[] = entries.map((entry, index) => ({
      ...entry,
      modifiedAt: modifiedTimes[index] ?? "1970-01-01T00:00:00.000Z",
    }));

    expect(sortProjectEntries(timedEntries, "modified-descending").map((entry) => entry.name)).toEqual([
      "zeta", "alpha", "a.txt", "z.txt",
    ]);
    expect(sortProjectEntries(timedEntries, "modified-ascending").map((entry) => entry.name)).toEqual([
      "alpha", "zeta", "z.txt", "a.txt",
    ]);
  });

  it("uses the saved custom path order", () => {
    expect(sortProjectEntries(entries, "custom", [
      "z.txt", "alpha", "a.txt", "zeta",
    ]).map((entry) => entry.name)).toEqual([
      "z.txt", "alpha", "a.txt", "zeta",
    ]);
  });

  it("moves a custom entry before or after a sibling", () => {
    const paths = ["apps", "doc", "packages", "package.json"];

    expect(reorderProjectPaths(paths, "doc", "apps", "before")).toEqual([
      "doc", "apps", "packages", "package.json",
    ]);
    expect(reorderProjectPaths(paths, "apps", "packages", "after")).toEqual([
      "doc", "packages", "apps", "package.json",
    ]);
  });
});
