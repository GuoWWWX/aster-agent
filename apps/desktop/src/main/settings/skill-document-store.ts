import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  createSkillDocumentInputSchema,
  createSkillMarkdown,
  parseSkillMarkdown,
  skillDiscoveryResultSchema,
  skillDocumentSchema,
  skillDocumentSaveInputSchema,
  type CreateSkillDocumentInput,
  type SkillConfiguration,
  type SkillDiscoveryResult,
  type SkillDocument,
  type SkillDocumentSaveInput,
} from "@agent/protocol";

import { IntegrationConfigurationStore } from "./integration-configuration-store.js";

const DISCOVERY_IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const MAX_DISCOVERED_SKILLS = 500;
const MAX_SCANNED_DIRECTORIES = 10_000;

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function nextSkillId(name: string, usedIds: Set<string>): string {
  const base = name.slice(0, 80);
  let suffix = 1;
  let id = base;
  while (usedIds.has(id)) {
    suffix += 1;
    id = `${base.slice(0, Math.max(1, 80 - String(suffix).length - 1))}-${suffix}`;
  }
  usedIds.add(id);
  return id;
}

export class SkillDocumentStore {
  public constructor(
    private readonly integrationConfiguration: IntegrationConfigurationStore,
    private readonly managedSkillsPath: string,
  ) {}

  public chooseDirectory(directoryPath: string): SkillDiscoveryResult {
    const managedDirectoryPath = this.getManagedDirectoryPath();
    const canonicalDirectoryPath = this.resolveExistingDirectory(directoryPath);
    if (!samePath(managedDirectoryPath, canonicalDirectoryPath)) {
      const configuration = this.integrationConfiguration.getConfiguration();
      const existing = configuration.skillDirectories.some((candidate) => {
        try {
          return samePath(this.resolveExistingDirectory(candidate), canonicalDirectoryPath);
        } catch {
          return samePath(candidate, canonicalDirectoryPath);
        }
      });
      if (!existing) {
        this.integrationConfiguration.saveConfiguration({
          ...configuration,
          skillDirectories: [...configuration.skillDirectories, canonicalDirectoryPath],
        });
      }
    }
    return this.discoverDocuments();
  }

  public createManagedDocument(input?: CreateSkillDocumentInput): SkillDocument {
    const parsedInput = createSkillDocumentInputSchema.parse(input ?? {});
    const rootPath = parsedInput.directoryPath === undefined || parsedInput.directoryPath === null
      ? this.getManagedDirectoryPath()
      : this.resolveRegisteredDirectory(parsedInput.directoryPath);
    let suffix = 1;
    let name = "new-skill";
    let directory = path.join(rootPath, name);
    while (existsSync(directory)) {
      suffix += 1;
      name = `new-skill-${suffix}`;
      directory = path.join(rootPath, name);
    }
    mkdirSync(directory, { recursive: false });
    for (const childDirectory of ["assets", "references", "scripts"]) {
      mkdirSync(path.join(directory, childDirectory), { recursive: false });
    }
    const entryPath = path.join(directory, "SKILL.md");
    const content = createSkillMarkdown({
      description: "说明该 Skill 应在什么情况下使用。",
      name,
    });
    writeFileSync(entryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const document = this.toDocument(entryPath, content);
    this.synchronizeDocuments([document]);
    return document;
  }

  public discoverDocuments(): SkillDiscoveryResult {
    const defaultDirectoryPath = this.getManagedDirectoryPath();
    const configuration = this.integrationConfiguration.getConfiguration();
    const directories = [defaultDirectoryPath, ...configuration.skillDirectories];
    const documents = new Map<string, SkillDocument>();

    for (const directory of directories) {
      let rootPath: string;
      try {
        rootPath = this.resolveExistingDirectory(directory);
      } catch {
        continue;
      }
      for (const document of this.scanDirectory(rootPath)) {
        documents.set(pathKey(document.entryPath), document);
      }
    }

    const discovered = [...documents.values()].sort((left, right) => (
      left.entryPath.localeCompare(right.entryPath, undefined, { sensitivity: "base" })
    ));
    this.synchronizeDocuments(discovered);
    return skillDiscoveryResultSchema.parse({ defaultDirectoryPath, documents: discovered });
  }

  public importDocument(entryPath: string): SkillDocument {
    const document = this.readPath(entryPath);
    this.synchronizeDocuments([document]);
    return document;
  }

  public readDocument(entryPath: string): SkillDocument {
    this.assertRegistered(entryPath);
    return this.readPath(entryPath);
  }

  public saveDocument(input: SkillDocumentSaveInput): SkillDocument {
    const parsedInput = skillDocumentSaveInputSchema.parse(input);
    this.assertRegistered(parsedInput.entryPath);
    this.assertSkillEntryPath(parsedInput.entryPath);
    const document = this.toDocument(parsedInput.entryPath, parsedInput.content);

    const temporaryPath = `${parsedInput.entryPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, parsedInput.content, { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, parsedInput.entryPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
    this.synchronizeDocuments([document]);
    return document;
  }

  private assertRegistered(entryPath: string): void {
    const resolved = path.resolve(entryPath);
    const registered = this.integrationConfiguration
      .getConfiguration()
      .skills.some((skill) => samePath(skill.entryPath, resolved));
    if (!registered) throw new Error("只能读取或保存已登记的 Skill 文档。");
  }

  private assertSkillEntryPath(entryPath: string): void {
    if (path.basename(entryPath).toUpperCase() !== "SKILL.MD") {
      throw new Error("Skill 入口文件必须命名为 SKILL.md。");
    }
  }

  private getManagedDirectoryPath(): string {
    mkdirSync(this.managedSkillsPath, { recursive: true });
    return this.resolveExistingDirectory(this.managedSkillsPath);
  }

  private resolveExistingDirectory(directoryPath: string): string {
    const resolved = path.resolve(directoryPath);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error("Skill 目录不存在或不是目录。");
    }
    return path.resolve(realpathSync(resolved));
  }

  private resolveRegisteredDirectory(directoryPath: string): string {
    const resolved = this.resolveExistingDirectory(directoryPath);
    const managedDirectoryPath = this.getManagedDirectoryPath();
    if (samePath(resolved, managedDirectoryPath)) return managedDirectoryPath;
    const isRegistered = this.integrationConfiguration
      .getConfiguration()
      .skillDirectories.some((candidate) => {
        try {
          return samePath(this.resolveExistingDirectory(candidate), resolved);
        } catch {
          return false;
        }
      });
    if (!isRegistered) throw new Error("只能在默认目录或已登记的 Skill 目录中创建。");
    return resolved;
  }

  private scanDirectory(rootPath: string): SkillDocument[] {
    const documents: SkillDocument[] = [];
    const pendingDirectories = [rootPath];
    let scannedDirectoryCount = 0;

    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop();
      if (directory === undefined) continue;
      scannedDirectoryCount += 1;
      if (scannedDirectoryCount > MAX_SCANNED_DIRECTORIES) {
        throw new Error("Skill 目录扫描项过多，已停止扫描。");
      }

      const entries = readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!DISCOVERY_IGNORED_DIRECTORIES.has(entry.name)) pendingDirectories.push(entryPath);
          continue;
        }
        if (!entry.isFile() || entry.name.toUpperCase() !== "SKILL.MD") continue;
        try {
          documents.push(this.readPath(entryPath));
        } catch {
          // Invalid external documents must not prevent other Skills from being discovered.
        }
        if (documents.length > MAX_DISCOVERED_SKILLS) {
          throw new Error("发现的 Skill 数量超过 500 个，请缩小扫描目录。");
        }
      }
    }

    return documents;
  }

  private synchronizeDocuments(documents: readonly SkillDocument[]): void {
    if (documents.length === 0) return;
    const configuration = this.integrationConfiguration.getConfiguration();
    const ids = new Set(configuration.skills.map((skill) => skill.id));
    const existingByPath = new Map(
      configuration.skills.map((skill) => [pathKey(skill.entryPath), skill]),
    );
    let changed = false;
    const updatedSkills = configuration.skills.map((skill) => {
      const document = documents.find((candidate) => samePath(candidate.entryPath, skill.entryPath));
      if (document === undefined) return skill;
      const updated: SkillConfiguration = {
        ...skill,
        description: document.metadata.description,
        entryPath: document.entryPath,
        name: document.metadata.name,
      };
      if (
        updated.description !== skill.description
        || updated.entryPath !== skill.entryPath
        || updated.name !== skill.name
      ) {
        changed = true;
      }
      return updated;
    });

    for (const document of documents) {
      if (existingByPath.has(pathKey(document.entryPath))) continue;
      updatedSkills.push({
        description: document.metadata.description,
        enabled: true,
        entryPath: document.entryPath,
        id: nextSkillId(document.metadata.name, ids),
        mcpDependencies: [],
        name: document.metadata.name,
        scope: "user",
        version: "",
      });
      changed = true;
    }

    if (changed) {
      this.integrationConfiguration.saveConfiguration({
        ...configuration,
        skills: updatedSkills,
      });
    }
  }

  private readPath(entryPath: string): SkillDocument {
    this.assertSkillEntryPath(entryPath);
    if (!existsSync(entryPath) || !lstatSync(entryPath).isFile()) {
      throw new Error("找不到 Skill 入口文件。");
    }
    return this.toDocument(entryPath, readFileSync(entryPath, "utf8"));
  }

  private toDocument(entryPath: string, content: string): SkillDocument {
    const { metadata } = parseSkillMarkdown(content);
    const directoryName = path.basename(path.dirname(entryPath));
    if (metadata.name !== directoryName) {
      throw new Error(
        `SKILL.md 的 name 必须与父目录名一致：期望 ${directoryName}，实际 ${metadata.name}。`,
      );
    }
    return skillDocumentSchema.parse({ content, entryPath: path.resolve(entryPath), metadata });
  }
}
