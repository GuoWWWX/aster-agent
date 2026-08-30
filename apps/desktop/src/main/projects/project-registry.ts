import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createProjectEntryInputSchema,
  listProjectEntriesInputSchema,
  projectEntrySchema,
  projectFileSchema,
  projectPreviewImageSchema,
  readProjectFileInputSchema,
  readProjectPreviewImageInputSchema,
  relativeProjectPathSchema,
  type CreateProjectEntryInput,
  type ListProjectEntriesInput,
  type JavaDeclarationKind,
  type ProjectDirectoryListing,
  type ProjectEntry,
  type ProjectFile,
  type ProjectPreviewImage,
  type ReadProjectFileInput,
  type ReadProjectPreviewImageInput,
  type ProjectSummary
} from "@agent/protocol";
import {
  isPathInsideRoot,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
  resolveWritablePathWithinRoot,
} from "../security/workspace-path.js";
import { readBoundedFilePreview } from "../storage/read-bounded-file-preview.js";

const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_FILE_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_JAVA_DECLARATION_BYTES = 128 * 1024;
/** Generous for embedded document images; rejected outright above this — base64 cannot be safely truncated. */
const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;
const REMOTE_IMAGE_SOURCE_PATTERN = /^(?:https?:|data:|blob:)/i;
const PREVIEW_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

type RegisteredProject = ProjectSummary & {
  canonicalRoot: string;
};

export type ProjectStore = {
  deleteProject(projectId: string): void;
  listProjects(): ProjectSummary[];
  reorderProjects?(projectIds: readonly string[]): void;
  saveProject(project: ProjectSummary): void;
};

function compareEntries(left: ProjectEntry, right: ProjectEntry): number {
  const leftIsDirectory = left.kind === "directory";
  const rightIsDirectory = right.kind === "directory";

  if (leftIsDirectory !== rightIsDirectory) {
    return leftIsDirectory ? -1 : 1;
  }

  return left.name.localeCompare(right.name, "zh-CN");
}

function isJavaIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function isJavaIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[\w$]/u.test(character);
}

function maskJavaCommentsAndLiterals(source: string): string {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (character === "/" && next === "/") {
      result += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          result += "  ";
          index += 2;
          break;
        }
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    const isTextBlock = source.startsWith('"""', index);
    if (character === '"' || character === "'") {
      const delimiter = isTextBlock ? '"""' : character;
      result += " ".repeat(delimiter.length);
      index += delimiter.length;
      while (index < source.length) {
        if (source.startsWith(delimiter, index)) {
          result += " ".repeat(delimiter.length);
          index += delimiter.length;
          break;
        }
        if (!isTextBlock && source[index] === "\\") {
          result += "  ";
          index += 2;
          continue;
        }
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

function detectJavaDeclarationKind(
  source: string,
  expectedName: string
): JavaDeclarationKind | undefined {
  const code = maskJavaCommentsAndLiterals(source);
  const declarations: Array<{ kind: JavaDeclarationKind; name: string }> = [];
  let braceDepth = 0;
  let index = 0;

  while (index < code.length) {
    const character = code[index];
    if (character === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }
    if (braceDepth !== 0 || !isJavaIdentifierStart(character)) {
      index += 1;
      continue;
    }

    const tokenStart = index;
    index += 1;
    while (isJavaIdentifierPart(code[index])) index += 1;
    const token = code.slice(tokenStart, index);
    if (!["class", "enum", "interface", "record"].includes(token)) continue;

    let nameStart = index;
    while (/\s/u.test(code[nameStart] ?? "")) nameStart += 1;
    if (!isJavaIdentifierStart(code[nameStart])) continue;
    let nameEnd = nameStart + 1;
    while (isJavaIdentifierPart(code[nameEnd])) nameEnd += 1;

    let previousIndex = tokenStart - 1;
    while (/\s/u.test(code[previousIndex] ?? "")) previousIndex -= 1;
    const kind: JavaDeclarationKind =
      token === "interface" && code[previousIndex] === "@"
        ? "annotation"
        : token as JavaDeclarationKind;
    declarations.push({ kind, name: code.slice(nameStart, nameEnd) });
  }

  return declarations.find((declaration) => declaration.name === expectedName)?.kind
    ?? declarations[0]?.kind;
}

async function readJavaDeclarationKind(
  filePath: string,
  fileName: string
): Promise<JavaDeclarationKind | undefined> {
  const contents = Buffer.alloc(MAX_JAVA_DECLARATION_BYTES);
  try {
    const handle = await open(filePath, "r");
    try {
      const { bytesRead } = await handle.read(contents, 0, contents.length, 0);
      return detectJavaDeclarationKind(
        new TextDecoder("utf-8").decode(contents.subarray(0, bytesRead)),
        path.basename(fileName, path.extname(fileName))
      );
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * The first file-tree slice intentionally keeps approved projects in process
 * memory. Storage will replace this registry with a persistent repository.
 */
export class ProjectRegistry {
  private readonly projectsById = new Map<string, RegisteredProject>();
  private readonly conversationWorkspacesById = new Map<string, RegisteredProject>();

  public constructor(private readonly store?: ProjectStore) {
    for (const project of store?.listProjects() ?? []) {
      this.projectsById.set(project.id, {
        ...project,
        canonicalRoot: path.resolve(project.rootPath)
      });
    }
  }

  public async registerDirectory(selectedDirectory: string): Promise<ProjectSummary> {
    const canonicalRoot = path.resolve(await realpath(selectedDirectory));
    const directoryInfo = await stat(canonicalRoot);

    if (!directoryInfo.isDirectory()) {
      throw new Error("Selected project path is not a directory.");
    }

    const existingProject = [...this.projectsById.values()].find(
      (project) => project.canonicalRoot === canonicalRoot
    );

    if (existingProject !== undefined) {
      return this.toProjectSummary(existingProject);
    }

    const project: RegisteredProject = {
      canonicalRoot,
      id: randomUUID(),
      isPinned: false,
      name: path.basename(canonicalRoot) || canonicalRoot,
      rootPath: canonicalRoot,
      showTeamsInNavigator: false
    };

    this.projectsById.set(project.id, project);
    this.store?.saveProject(this.toProjectSummary(project));

    return this.toProjectSummary(project);
  }

  public async mountConversationWorkspace(
    conversationId: string,
    selectedDirectory: string
  ): Promise<ProjectSummary> {
    const canonicalRoot = path.resolve(await realpath(selectedDirectory));
    const directoryInfo = await stat(canonicalRoot);
    if (!directoryInfo.isDirectory()) {
      throw new Error("Selected conversation workspace is not a directory.");
    }
    const workspace: RegisteredProject = {
      canonicalRoot,
      id: conversationId,
      name: path.basename(canonicalRoot) || canonicalRoot,
      rootPath: canonicalRoot
    };
    this.conversationWorkspacesById.set(conversationId, workspace);
    return this.toProjectSummary(workspace);
  }

  public unmountConversationWorkspace(conversationId: string): void {
    this.conversationWorkspacesById.delete(conversationId);
  }

  public inheritConversationWorkspace(
    sourceConversationId: string,
    targetConversationId: string
  ): void {
    const source = this.conversationWorkspacesById.get(sourceConversationId);
    if (source === undefined) return;
    this.conversationWorkspacesById.set(targetConversationId, {
      ...source,
      id: targetConversationId
    });
  }

  public listProjects(): ProjectSummary[] {
    return [...this.projectsById.values()].map((project) =>
      this.toProjectSummary(project)
    );
  }

  public getProject(projectId: string): ProjectSummary {
    const project = this.getAuthorizedWorkspace(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    return this.toProjectSummary(project);
  }

  public renameProject(projectId: string, name: string): ProjectSummary {
    const project = this.projectsById.get(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    project.name = name;
    const summary = this.toProjectSummary(project);
    this.store?.saveProject(summary);
    return summary;
  }

  public setProjectPinned(projectId: string, pinned: boolean): ProjectSummary {
    const project = this.projectsById.get(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    project.isPinned = pinned;
    const summary = this.toProjectSummary(project);
    this.store?.saveProject(summary);
    return summary;
  }

  public setProjectTeamsInNavigator(
    projectId: string,
    showTeamsInNavigator: boolean
  ): ProjectSummary {
    const project = this.projectsById.get(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    project.showTeamsInNavigator = showTeamsInNavigator;
    const summary = this.toProjectSummary(project);
    this.store?.saveProject(summary);
    return summary;
  }

  public reorderProjects(projectIds: readonly string[]): ProjectSummary[] {
    const projects = projectIds.map((projectId) => this.projectsById.get(projectId));
    const first = projects[0];
    if (
      first === undefined
      || projects.some((project) => project === undefined)
      || projects.some((project) => project?.isPinned !== first.isPinned)
      || projects.length !== [...this.projectsById.values()].filter(
        (project) => project.isPinned === first.isPinned
      ).length
    ) {
      throw new Error("Projects can only be reordered inside one complete pin group.");
    }
    this.store?.reorderProjects?.(projectIds);
    const otherProjects = [...this.projectsById.values()].filter(
      (project) => project.isPinned !== first.isPinned
    );
    const orderedProjects = projects as RegisteredProject[];
    this.projectsById.clear();
    for (const project of first.isPinned
      ? [...orderedProjects, ...otherProjects]
      : [...otherProjects, ...orderedProjects]) {
      this.projectsById.set(project.id, project);
    }
    return this.listProjects();
  }

  public removeProject(projectId: string): void {
    if (!this.projectsById.has(projectId)) {
      throw new Error("Project is not registered for this application session.");
    }
    this.store?.deleteProject(projectId);
    this.projectsById.delete(projectId);
  }

  public async resolveProjectPath(
    projectId: string,
    relativePath: string
  ): Promise<string> {
    const validatedPath = relativeProjectPathSchema.parse(relativePath);
    const project = this.getAuthorizedWorkspace(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    return resolveExistingPathWithinRoot(
      project.canonicalRoot,
      validatedPath,
      {
        outsideRoot: "Project path is outside the registered project root.",
        resolvedOutsideRoot: "Project path resolves outside the registered project root.",
        symbolicLink: "Symbolic links cannot be edited through a project workspace.",
      },
    );
  }

  /** Resolves a writable path while retaining the same project-root boundary. */
  public async resolveWritableProjectPath(
    projectId: string,
    relativePath: string
  ): Promise<string> {
    const validatedPath = relativeProjectPathSchema
      .refine((value) => value.length > 0, { message: "A file path is required." })
      .parse(relativePath);
    const project = this.getAuthorizedWorkspace(projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }
    return resolveWritablePathWithinRoot(
      project.canonicalRoot,
      validatedPath,
      {
        outsideRoot: "Project path is outside the registered project root.",
        resolvedOutsideRoot: "Project path resolves outside the registered project root.",
        symbolicLink: "Symbolic links cannot be edited through a project workspace.",
      },
    );
  }

  public async listEntries(
    input: ListProjectEntriesInput
  ): Promise<ProjectDirectoryListing> {
    const validatedInput = listProjectEntriesInputSchema.parse(input);
    const project = this.getAuthorizedWorkspace(validatedInput.projectId);

    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }

    const directoryPath = this.resolveDirectoryPath(project, validatedInput.directoryPath);
    const canonicalDirectoryPath = path.resolve(await realpath(directoryPath));

    if (!isPathInsideRoot(project.canonicalRoot, canonicalDirectoryPath)) {
      throw new Error("Project directory path is outside the registered project root.");
    }

    const directoryInfo = await stat(canonicalDirectoryPath);
    if (!directoryInfo.isDirectory()) {
      throw new Error("Requested project path is not a directory.");
    }

    const rawEntries = await readdir(canonicalDirectoryPath, {
      withFileTypes: true
    });
    const truncated = rawEntries.length > MAX_DIRECTORY_ENTRIES;
    const entries = rawEntries
      .map((entry): ProjectEntry => ({
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : "file",
        name: entry.name,
        path:
          validatedInput.directoryPath.length === 0
            ? entry.name
            : `${validatedInput.directoryPath}/${entry.name}`
      }))
      .sort(compareEntries)
      .slice(0, MAX_DIRECTORY_ENTRIES);
    const enrichedEntries = await Promise.all(
      entries.map(async (entry): Promise<ProjectEntry> => {
        const entryPath = path.join(canonicalDirectoryPath, entry.name);
        const modifiedAt = await lstat(entryPath)
          .then((entryInfo) => entryInfo.mtime.toISOString())
          .catch(() => undefined);
        const entryWithModifiedAt: ProjectEntry = modifiedAt === undefined
          ? entry
          : { ...entry, modifiedAt };
        if (entry.kind !== "file" || path.extname(entry.name).toLowerCase() !== ".java") {
          return entryWithModifiedAt;
        }
        const javaDeclarationKind = await readJavaDeclarationKind(
          entryPath,
          entry.name
        );
        return javaDeclarationKind === undefined
          ? entryWithModifiedAt
          : { ...entryWithModifiedAt, javaDeclarationKind };
      })
    );

    return {
      directoryPath: validatedInput.directoryPath,
      entries: enrichedEntries,
      projectId: project.id,
      truncated
    };
  }

  public async createEntry(input: CreateProjectEntryInput): Promise<ProjectEntry> {
    const validatedInput = createProjectEntryInputSchema.parse(input);
    const targetPath = await this.resolveWritableProjectPath(
      validatedInput.projectId,
      validatedInput.path
    );

    if (validatedInput.kind === "directory") {
      await mkdir(targetPath);
    } else {
      await writeFile(targetPath, "", { encoding: "utf8", flag: "wx" });
    }

    return projectEntrySchema.parse({
      kind: validatedInput.kind,
      name: path.basename(targetPath),
      path: validatedInput.path
    });
  }

  public async readFile(input: ReadProjectFileInput): Promise<ProjectFile> {
    const validatedInput = readProjectFileInputSchema.parse(input);
    const filePath = await this.resolveProjectPath(
      validatedInput.projectId,
      validatedInput.path
    );
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      throw new Error("Requested project path is not a file.");
    }

    const preview = await readBoundedFilePreview(filePath, MAX_FILE_PREVIEW_BYTES);

    return projectFileSchema.parse({
      byteLength: preview.byteLength,
      content: preview.content,
      isBinary: preview.isBinary,
      name: path.basename(filePath),
      path: validatedInput.path,
      projectId: validatedInput.projectId,
      truncated: preview.truncated,
    });
  }

  /**
   * Reads an image referenced from inside a Markdown file's body. `path` is the raw
   * reference as authored (may contain `../`, a leading `/`, or be malformed) — it is
   * resolved relative to `sourcePath`'s directory, then re-validated as a normal project
   * path before any filesystem access. This mirrors md-king's Tauri `load_preview_image`
   * command, which took the same two-argument shape for the same reason.
   */
  public async readPreviewImage(input: ReadProjectPreviewImageInput): Promise<ProjectPreviewImage> {
    const validatedInput = readProjectPreviewImageInputSchema.parse(input);
    if (REMOTE_IMAGE_SOURCE_PATTERN.test(validatedInput.path)) {
      throw new Error("Remote and data image sources are not read through this channel.");
    }

    const project = this.getAuthorizedWorkspace(validatedInput.projectId);
    if (project === undefined) {
      throw new Error("Project is not registered for this application session.");
    }

    const rawReference = validatedInput.path.split(/[?#]/)[0] ?? validatedInput.path;
    const resolvedReference = rawReference.startsWith("/")
      ? rawReference.slice(1)
      : path.posix.join(path.posix.dirname(validatedInput.sourcePath), rawReference);
    const normalizedPath = path.posix.normalize(resolvedReference);

    const validatedRelativePath = relativeProjectPathSchema
      .refine((value) => value.length > 0, {
        message: "Image reference resolves to an empty path."
      })
      .parse(normalizedPath);

    const extension = normalizedPath.split(".").at(-1)?.toLocaleLowerCase("en-US");
    const mimeType = extension === undefined ? undefined : PREVIEW_IMAGE_MIME_TYPES[extension];
    if (mimeType === undefined) {
      throw new Error("Unsupported preview image type.");
    }

    const filePath = await resolveExistingPathWithinRoot(
      project.canonicalRoot,
      validatedRelativePath,
      {
        outsideRoot: "Preview image path is outside the registered project root.",
        resolvedOutsideRoot: "Preview image path resolves outside the registered project root.",
        symbolicLink: "Symbolic links cannot be read as preview images.",
      },
    );

    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Preview image path is not a file.");
    if (fileInfo.size > MAX_PREVIEW_IMAGE_BYTES) {
      throw new Error("Preview image exceeds the size limit.");
    }

    const data = (await readFile(filePath)).toString("base64");
    return projectPreviewImageSchema.parse({ data, mimeType });
  }

  private getAuthorizedWorkspace(workspaceId: string): RegisteredProject | undefined {
    return this.projectsById.get(workspaceId) ??
      this.conversationWorkspacesById.get(workspaceId);
  }

  private resolveDirectoryPath(
    project: RegisteredProject,
    directoryPath: string
  ): string {
    return resolvePathWithinRoot(
      project.canonicalRoot,
      directoryPath,
      { outsideRoot: "Project directory path is outside the registered project root." },
    );
  }

  private toProjectSummary(project: RegisteredProject): ProjectSummary {
    return {
      id: project.id,
      isPinned: project.isPinned ?? false,
      name: project.name,
      rootPath: project.rootPath,
      ...(project.showTeamsInNavigator === true ? { showTeamsInNavigator: true } : {})
    };
  }
}
