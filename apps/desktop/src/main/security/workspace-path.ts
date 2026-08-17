import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type WorkspacePathMessages = {
  outsideRoot: string;
  resolvedOutsideRoot: string;
  symbolicLink?: string;
};

const DEFAULT_MESSAGES: WorkspacePathMessages = {
  outsideRoot: "Path is outside the workspace root.",
  resolvedOutsideRoot: "Path resolves outside the workspace root.",
  symbolicLink: "Symbolic links cannot be edited through a workspace.",
};

function messages(value?: Partial<WorkspacePathMessages>): WorkspacePathMessages {
  return { ...DEFAULT_MESSAGES, ...value };
}

export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relativePath === ""
    || (!relativePath.startsWith(`..${path.sep}`)
      && relativePath !== ".."
      && !path.isAbsolute(relativePath));
}

export function resolvePathWithinRoot(
  rootPath: string,
  relativePath: string,
  errorMessages?: Partial<WorkspacePathMessages>,
): string {
  const targetPath = path.resolve(rootPath, ...relativePath.split("/"));
  const resolvedMessages = messages(errorMessages);
  if (!isPathInsideRoot(rootPath, targetPath)) {
    throw new Error(resolvedMessages.outsideRoot);
  }
  return targetPath;
}

export async function resolveExistingPathWithinRoot(
  rootPath: string,
  relativePath: string,
  errorMessages?: Partial<WorkspacePathMessages>,
): Promise<string> {
  const resolvedMessages = messages(errorMessages);
  const targetPath = resolvePathWithinRoot(rootPath, relativePath, resolvedMessages);
  const canonicalPath = path.resolve(await realpath(targetPath));
  if (!isPathInsideRoot(rootPath, canonicalPath)) {
    throw new Error(resolvedMessages.resolvedOutsideRoot);
  }
  return canonicalPath;
}

export async function resolveWritablePathWithinRoot(
  rootPath: string,
  relativePath: string,
  errorMessages?: Partial<WorkspacePathMessages>,
): Promise<string> {
  const resolvedMessages = messages(errorMessages);
  const targetPath = resolvePathWithinRoot(rootPath, relativePath, resolvedMessages);
  const canonicalParentPath = path.resolve(await realpath(path.dirname(targetPath)));
  if (!isPathInsideRoot(rootPath, canonicalParentPath)) {
    throw new Error(resolvedMessages.resolvedOutsideRoot);
  }
  try {
    if ((await lstat(targetPath)).isSymbolicLink()) {
      throw new Error(resolvedMessages.symbolicLink);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return targetPath;
}
