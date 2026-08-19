import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { SkillRuntime } from "./skill-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture(): Promise<{
  entryPath: string;
  integrations: IntegrationConfigurationStore;
  runtime: SkillRuntime;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-skill-runtime-"));
  temporaryDirectories.push(directory);
  const skillDirectory = path.join(directory, "skills", "review");
  await mkdir(skillDirectory, { recursive: true });
  const entryPath = path.join(skillDirectory, "SKILL.md");
  await writeFile(entryPath, [
    "---",
    "name: review",
    "description: Review changed code.",
    "---",
    "",
    "# Review rules",
    "",
    "Use evidence and report exact paths.",
    "",
  ].join("\n"), "utf8");
  const integrations = new IntegrationConfigurationStore(path.join(directory, "integrations.json"));
  integrations.saveConfiguration({
    mcpServers: [],
    skillDirectories: [],
    skills: [{
      description: "Review changed code.",
      enabled: true,
      entryPath,
      id: "review",
      mcpDependencies: [],
      name: "review",
      scope: "user",
      version: "1.2.0",
    }],
    version: 1,
  });
  const documents = new SkillDocumentStore(integrations, path.join(directory, "managed"));
  return { entryPath, integrations, runtime: new SkillRuntime(documents, integrations) };
}

describe("SkillRuntime", () => {
  it("exposes a bounded catalog and returns only a load summary", async () => {
    const { runtime } = await fixture();

    const catalog = runtime.getCatalog({ projectId: undefined });
    expect(catalog).toEqual([expect.objectContaining({
      description: "Review changed code.",
      id: "review",
      version: "1.2.0",
    })]);
    const result = runtime.execute({
      arguments: JSON.stringify({ skillId: "review" }),
      context: { projectId: undefined },
      toolName: "load_skill",
    });
    expect(result.isError).toBe(false);
    expect(result.content).not.toContain("Use evidence and report exact paths");
    expect(result.snapshot).toMatchObject({ id: "review", version: "1.2.0" });
  });

  it("injects the body only through an active context message", async () => {
    const { runtime } = await fixture();
    const loaded = runtime.loadSkill("review", { projectId: undefined });
    const message = runtime.buildActiveContext([{
      contentHash: loaded.contentHash,
      id: loaded.id,
      version: loaded.version,
    }], { projectId: undefined });
    expect(message?.role).toBe("system");
    expect(message?.content).toContain("Use evidence and report exact paths");
  });

  it("uses the shared conservative token estimate for non-Latin Skill text", async () => {
    const { entryPath, runtime } = await fixture();
    await writeFile(entryPath, [
      "---",
      "name: review",
      "description: Review changed code.",
      "---",
      "",
      "# 审查规则",
      "",
      "每一条结论都必须有准确的文件位置和可复现证据。",
      "",
    ].join("\n"), "utf8");
    const loaded = runtime.loadSkill("review", { projectId: undefined });

    expect(() => runtime.buildActiveContext([{
      contentHash: loaded.contentHash,
      id: loaded.id,
      version: loaded.version,
    }], { projectId: undefined }, 60)).toThrow("超过本轮上下文预算");
  });

  it("rejects a changed Skill instead of silently restoring an old snapshot", async () => {
    const { entryPath, runtime } = await fixture();
    const loaded = runtime.loadSkill("review", { projectId: undefined });
    await writeFile(entryPath, [
      "---",
      "name: review",
      "description: Review changed code.",
      "---",
      "",
      "# Changed rules",
      "",
      "Do something else.",
      "",
    ].join("\n"), "utf8");

    expect(() => runtime.buildActiveContext([{
      contentHash: loaded.contentHash,
      id: loaded.id,
      version: loaded.version,
    }], { projectId: undefined })).toThrow("无法静默恢复旧 Run");
  });

  it("rejects an oversized SKILL.md before the document store reads it", async () => {
    const { entryPath, runtime } = await fixture();
    await writeFile(entryPath, "a".repeat(800_001), "utf8");

    expect(() => runtime.loadSkill("review", { projectId: undefined }))
      .toThrow("超过 800000 字节");
  });

  it("does not advertise a Skill whose MCP dependency is unavailable", async () => {
    const { integrations, runtime } = await fixture();
    const current = integrations.getConfiguration();
    integrations.saveConfiguration({
      ...current,
      skills: current.skills.map((skill) => ({ ...skill, mcpDependencies: ["missing-server"] })),
    });
    expect(runtime.getCatalog({ projectId: undefined })).toEqual([]);
  });

  it("advertises team-scoped Skills only inside a team conversation", async () => {
    const { integrations, runtime } = await fixture();
    const current = integrations.getConfiguration();
    integrations.saveConfiguration({
      ...current,
      skills: current.skills.map((skill) => ({ ...skill, scope: "team" as const })),
    });

    expect(runtime.getCatalog({ projectId: undefined })).toEqual([]);
    expect(runtime.getCatalog({ projectId: undefined, teamId: "team-1" }))
      .toEqual([expect.objectContaining({ id: "review", scope: "team" })]);
  });

  it("reads only bounded references and templates through the dedicated tool", async () => {
    const fixture = await createReferenceFixture();
    const loaded = fixture.runtime.execute({
      arguments: JSON.stringify({ skillId: "review" }),
      context: { projectId: undefined },
      toolName: "load_skill",
    });
    expect(loaded.content).toContain("references/checklist.md");
    expect(loaded.content).toContain("templates/report.md");

    const reference = fixture.runtime.execute({
      arguments: JSON.stringify({ path: "references/checklist.md", skillId: "review" }),
      context: { projectId: undefined },
      toolName: "read_skill_reference",
    });
    expect(reference.isError).toBe(false);
    expect(reference.content).toContain("只读检查清单");
    expect(reference.content).not.toContain("SKILL.md");
  });

  it("rejects Skill reference traversal and files outside the allowed roots", async () => {
    const fixture = await createReferenceFixture();
    for (const referencePath of ["../SKILL.md", "SKILL.md", "/etc/passwd", "templates/../SKILL.md"]) {
      const result = fixture.runtime.execute({
        arguments: JSON.stringify({ path: referencePath, skillId: "review" }),
        context: { projectId: undefined },
        toolName: "read_skill_reference",
      });
      expect(result.isError).toBe(true);
    }
  });

  it("requires an active Skill snapshot when the Runtime supplies active IDs", async () => {
    const fixture = await createReferenceFixture();
    const result = fixture.runtime.execute({
      arguments: JSON.stringify({ path: "references/checklist.md", skillId: "review" }),
      context: { activeSkillIds: [], projectId: undefined },
      toolName: "read_skill_reference",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("必须先通过 load_skill");
  });

  it("rejects malformed UTF-8 reference files", async () => {
    const fixture = await createReferenceFixture();
    const referencePath = path.join(path.dirname(fixture.entryPath), "references", "invalid.md");
    await writeFile(referencePath, Uint8Array.from([0xc3, 0x28]));

    const result = fixture.runtime.execute({
      arguments: JSON.stringify({ path: "references/invalid.md", skillId: "review" }),
      context: { activeSkillIds: ["review"], projectId: undefined },
      toolName: "read_skill_reference",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("UTF-8");
  });

  it("rejects reference files beyond the bounded text budget", async () => {
    const fixture = await createReferenceFixture();
    const referencePath = path.join(path.dirname(fixture.entryPath), "references", "oversized.md");
    await writeFile(referencePath, "a".repeat(80_001), "utf8");

    const result = fixture.runtime.execute({
      arguments: JSON.stringify({ path: "references/oversized.md", skillId: "review" }),
      context: { activeSkillIds: ["review"], projectId: undefined },
      toolName: "read_skill_reference",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("超过 80000 个字符");
  });
});

async function createReferenceFixture(): Promise<Awaited<ReturnType<typeof fixture>>> {
  const result = await fixture();
  const skillRoot = path.dirname(result.entryPath);
  await mkdir(path.join(skillRoot, "references"), { recursive: true });
  await mkdir(path.join(skillRoot, "templates"), { recursive: true });
  await writeFile(path.join(skillRoot, "references", "checklist.md"), "只读检查清单\n", "utf8");
  await writeFile(path.join(skillRoot, "templates", "report.md"), "报告模板\n", "utf8");
  return result;
}
