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
  it("creates a managed SKILL.md template", async () => {
    const { documents } = await createStores();
    const document = documents.createManagedDocument();

    expect(path.basename(document.entryPath)).toBe("SKILL.md");
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

  it("discovers default and registered external Skill directories", async () => {
    const { directory, documents, integrations } = await createStores();
    const managedEntryPath = path.join(directory, "managed", "nested", "SKILL.md");
    const ignoredEntryPath = path.join(directory, "managed", "node_modules", "ignored", "SKILL.md");
    const externalDirectory = path.join(directory, "external");
    const externalEntryPath = path.join(externalDirectory, "review", "SKILL.md");
    await mkdir(path.dirname(managedEntryPath), { recursive: true });
    await mkdir(path.dirname(ignoredEntryPath), { recursive: true });
    await mkdir(path.dirname(externalEntryPath), { recursive: true });
    await writeFile(managedEntryPath, "---\nname: managed\ndescription: Managed skill.\n---\n\n# Workflow\n");
    await writeFile(ignoredEntryPath, "---\nname: ignored\ndescription: Ignored skill.\n---\n\n# Workflow\n");
    await writeFile(externalEntryPath, "---\nname: review\ndescription: Review code changes.\n---\n\n# Workflow\n");

    const result = documents.chooseDirectory(externalDirectory);

    expect(result.defaultDirectoryPath).toBe(path.join(directory, "managed"));
    expect(result.documents.map((document) => document.metadata.name)).toEqual(
      expect.arrayContaining(["managed", "review"]),
    );
    const configuration = integrations.getConfiguration();
    expect(configuration.skillDirectories).toEqual([externalDirectory]);
    expect(configuration.skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ entryPath: managedEntryPath, name: "managed" }),
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
});
