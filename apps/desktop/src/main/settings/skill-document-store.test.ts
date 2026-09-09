import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConfigurationStore } from "./integration-configuration-store.js";
import { SkillDocumentStore } from "./skill-document-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

async function createStores() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-skills-"));
  temporaryDirectories.push(directory);
  const integrations = new IntegrationConfigurationStore(path.join(directory, "integrations.json"));
  const documents = new SkillDocumentStore(integrations, path.join(directory, "managed"));
  return { directory, documents, integrations };
}

describe("SkillDocumentStore", () => {
  it("classifies bundled skills and disables only identical duplicate entries", async () => {
    const { directory, documents, integrations } = await createStores();
    const content = "---\nname: browser-use\ndescription: Browser.\n---\n\n# Browser\n";
    const oldPath = path.join(directory, "old", "browser-use", "SKILL.md");
    const customPath = path.join(directory, "custom", "browser-use", "SKILL.md");
    for (const entry of [oldPath, customPath]) await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(oldPath, content);
    await writeFile(customPath, content.replace("# Browser", "# My browser"));
    documents.importDocument(oldPath);
    documents.importDocument(customPath);
    const bundled = documents.ensureManagedDocument(content);
    documents.discoverDocuments();
    documents.ensureManagedDocument(content);
    const skills = integrations.getConfiguration().skills;
    expect(skills.find((skill) => skill.entryPath === oldPath)?.enabled).toBe(false);
    expect(skills.find((skill) => skill.entryPath === customPath)?.enabled).toBe(true);
    expect(skills.find((skill) => skill.entryPath === bundled.entryPath)?.origin).toBe("system");
    expect(await readFile(oldPath, "utf8")).toBe(content);
    const withResources = path.join(directory, "resources", "browser-use", "SKILL.md");
    await mkdir(path.join(path.dirname(withResources), "references"), { recursive: true });
    await writeFile(withResources, content);
    documents.importDocument(withResources);
    documents.ensureManagedDocument(content);
    expect(integrations.getConfiguration().skills.find((skill) => skill.entryPath === withResources)?.enabled).toBe(true);
    const personal = documents.createManagedDocument();
    expect(integrations.getConfiguration().skills.find((skill) => skill.entryPath === personal.entryPath)?.origin).not.toBe("system");
  });
  it("installs a bundled Skill once and preserves later user edits", async () => {
    const { documents, integrations } = await createStores();
    const bundled = "---\nname: browser-use\ndescription: Operate a browser.\n---\n\n# Browser\n";
    const installed = documents.ensureManagedDocument(bundled);
    await writeFile(installed.entryPath, bundled.replace("# Browser", "# Customized"), "utf8");

    const existing = documents.ensureManagedDocument(bundled);

    expect(existing.content).toContain("# Customized");
    expect(integrations.getConfiguration().skills).toEqual([
      expect.objectContaining({ id: "browser-use", name: "browser-use" }),
    ]);
  });

  it("creates a managed SKILL.md template", async () => {
    const { documents } = await createStores();
    const document = documents.createManagedDocument();

    expect(path.basename(document.entryPath)).toBe("SKILL.md");
    expect(path.basename(path.dirname(document.entryPath))).toBe(document.metadata.name);
    expect(document.metadata.name).toBe("new-skill");
    expect(await readFile(document.entryPath, "utf8")).toBe(document.content);
    await expect(readdir(path.dirname(document.entryPath))).resolves.toEqual(
      expect.arrayContaining(["assets", "references", "scripts", "SKILL.md"]),
    );
  });

  it("imports and registers an existing valid SKILL.md", async () => {
    const { directory, documents, integrations } = await createStores();
    const entryPath = path.join(directory, "review", "SKILL.md");
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "---\nname: review\ndescription: Review code changes.\n---\n\n# Workflow\n");

    expect(documents.importDocument(entryPath).metadata.name).toBe("review");
    expect(integrations.getConfiguration().skills).toEqual([
      expect.objectContaining({ entryPath, id: "review", name: "review" }),
    ]);
  });

  it("registers managed documents before atomically saving them", async () => {
    const { documents, integrations } = await createStores();
    const document = documents.createManagedDocument();
    expect(integrations.getConfiguration().skills).toEqual([
      expect.objectContaining({ entryPath: document.entryPath, id: document.metadata.name }),
    ]);
    const updated = document.content.replace("# Instructions", "# Updated instructions");

    expect(documents.saveDocument({ content: updated, entryPath: document.entryPath }).content).toBe(updated);
    expect(await readFile(document.entryPath, "utf8")).toBe(updated);
  });

  it("rejects a mismatched directory name without overwriting the registered document", async () => {
    const { documents } = await createStores();
    const document = documents.createManagedDocument();
    const invalid = document.content.replace("name: new-skill", "name: renamed-skill");

    expect(() => documents.saveDocument({ content: invalid, entryPath: document.entryPath }))
      .toThrow(/name 必须与父目录名一致/);
    expect(await readFile(document.entryPath, "utf8")).toBe(document.content);
  });

  it("rejects an imported SKILL.md whose name differs from its parent directory", async () => {
    const { directory, documents, integrations } = await createStores();
    const entryPath = path.join(directory, "review-folder", "SKILL.md");
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "---\nname: review\ndescription: Review code changes.\n---\n\n# Workflow\n");

    expect(() => documents.importDocument(entryPath)).toThrow(/name 必须与父目录名一致/);
    expect(integrations.getConfiguration().skills).toEqual([]);
  });

  it("discovers default and registered external Skill directories", async () => {
    const { directory, documents, integrations } = await createStores();
    const managedEntryPath = path.join(directory, "managed", "nested", "SKILL.md");
    const ignoredEntryPath = path.join(directory, "managed", "node_modules", "ignored", "SKILL.md");
    const externalDirectory = path.join(directory, "external");
    const externalEntryPath = path.join(externalDirectory, "review", "SKILL.md");
    await mkdir(path.dirname(managedEntryPath), { recursive: true });
    await mkdir(path.dirname(ignoredEntryPath), { recursive: true });
    await mkdir(path.dirname(externalEntryPath), { recursive: true });
    await writeFile(managedEntryPath, "---\nname: nested\ndescription: Managed skill.\n---\n\n# Workflow\n");
    await writeFile(ignoredEntryPath, "---\nname: ignored\ndescription: Ignored skill.\n---\n\n# Workflow\n");
    await writeFile(externalEntryPath, "---\nname: review\ndescription: Review code changes.\n---\n\n# Workflow\n");

    const result = documents.chooseDirectory(externalDirectory);

    expect(result.defaultDirectoryPath).toBe(path.join(directory, "managed"));
    expect(result.documents.map((document) => document.metadata.name)).toEqual(
      expect.arrayContaining(["nested", "review"]),
    );
    const configuration = integrations.getConfiguration();
    expect(configuration.skillDirectories).toEqual([externalDirectory]);
    expect(configuration.skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ entryPath: managedEntryPath, name: "nested" }),
        expect.objectContaining({ entryPath: externalEntryPath, name: "review" }),
    ]));
  });

  it("creates a Skill under a registered external directory", async () => {
    const { directory, documents } = await createStores();
    const externalDirectory = path.join(directory, "external");
    await mkdir(externalDirectory);
    documents.chooseDirectory(externalDirectory);

    const document = documents.createManagedDocument({ directoryPath: externalDirectory });

    expect(document.entryPath).toBe(path.join(externalDirectory, "new-skill", "SKILL.md"));
  });

  it("assigns distinct stable IDs to same-named Skills from different roots", async () => {
    const { directory, documents, integrations } = await createStores();
    const roots = [path.join(directory, "external-a"), path.join(directory, "external-b")];
    for (const root of roots) {
      const entryPath = path.join(root, "review", "SKILL.md");
      await mkdir(path.dirname(entryPath), { recursive: true });
      await writeFile(entryPath, "---\nname: review\ndescription: Review code changes.\n---\n\n# Workflow\n");
      documents.chooseDirectory(root);
    }

    expect(integrations.getConfiguration().skills.map((skill) => skill.id).sort())
      .toEqual(["review", "review-2"]);

    documents.discoverDocuments();
    expect(integrations.getConfiguration().skills.map((skill) => skill.id).sort())
      .toEqual(["review", "review-2"]);
  });
});
