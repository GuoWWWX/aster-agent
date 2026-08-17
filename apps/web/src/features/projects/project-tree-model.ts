import type { ProjectEntry } from "@agent/protocol";

export type DirectoryState = {
  entries: ProjectEntry[];
  errorMessage: string | null;
  isLoading: boolean;
  truncated: boolean;
};

export type DirectoryStates = Record<string, DirectoryState | undefined>;

export const ROOT_DIRECTORY_PATH = "";

const projectEntryCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export type ProjectTreeSortOption =
  | "custom"
  | "modified-ascending"
  | "modified-descending"
  | "name-ascending"
  | "name-descending";

export function sortProjectEntries(
  entries: readonly ProjectEntry[],
  option: ProjectTreeSortOption,
  customOrder: readonly string[] = [],
): ProjectEntry[] {
  if (option === "custom") {
    const customIndexes = new Map(customOrder.map((path, index) => [path, index]));
    return [...entries].sort((left, right) => {
      const leftIndex = customIndexes.get(left.path) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = customIndexes.get(right.path) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  }

  return [...entries].sort((left, right) => {
    const leftDirectory = left.kind === "directory";
    const rightDirectory = right.kind === "directory";
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;

    if (option.startsWith("modified")) {
      const timeComparison = projectEntryModifiedTime(left) - projectEntryModifiedTime(right);
      if (timeComparison !== 0) {
        return option === "modified-ascending" ? timeComparison : -timeComparison;
      }
    }

    const nameComparison = projectEntryCollator.compare(left.name, right.name);
    return option === "name-descending" ? -nameComparison : nameComparison;
  });
}

export function reorderProjectPaths(
  paths: readonly string[],
  sourcePath: string,
  targetPath: string,
  position: "after" | "before",
): string[] {
  const reordered = paths.filter((path) => path !== sourcePath);
  const targetIndex = reordered.indexOf(targetPath);
  if (targetIndex < 0) return [...paths];
  reordered.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourcePath);
  return reordered;
}

function projectEntryModifiedTime(entry: ProjectEntry): number {
  if (entry.modifiedAt === undefined) return 0;
  const timestamp = Date.parse(entry.modifiedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function filterProjectEntries(
  entries: ProjectEntry[],
  query: string,
): ProjectEntry[] {
  if (query.length === 0) {
    return entries;
  }

  const normalizedQuery = query.toLocaleLowerCase("zh-CN");

  return entries.filter((entry) =>
    entry.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
  );
}
