import { parseDocument } from "yaml";
import { z } from "zod";

const MAX_SKILL_DIRECTORY_PATH_LENGTH = 32_767;

export const skillDirectoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SKILL_DIRECTORY_PATH_LENGTH);

export const skillMetadataSchema = z
  .object({
    description: z.string().trim().min(1, "Skill description 不能为空。").max(1_024),
    name: z
      .string()
      .trim()
      .min(1, "Skill name 不能为空。")
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Skill name 只能使用小写字母、数字和连字符。"),
  })
  .passthrough();

export const skillDocumentReferenceInputSchema = z
  .object({ entryPath: z.string().trim().min(1).max(2_000) })
  .strict();

export const skillDocumentSaveInputSchema = z
  .object({
    content: z.string().max(2_000_000),
    entryPath: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const skillDocumentSchema = skillDocumentSaveInputSchema.extend({
  metadata: skillMetadataSchema.pick({ description: true, name: true }),
});

export const createSkillDocumentInputSchema = z
  .object({
    directoryPath: skillDirectoryPathSchema.nullable().optional(),
  })
  .strict();

export const skillDiscoveryResultSchema = z
  .object({
    defaultDirectoryPath: skillDirectoryPathSchema,
    documents: z.array(skillDocumentSchema).max(500),
  })
  .strict();

export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export type SkillDocumentReferenceInput = z.infer<typeof skillDocumentReferenceInputSchema>;
export type SkillDocumentSaveInput = z.infer<typeof skillDocumentSaveInputSchema>;
export type SkillDocument = z.infer<typeof skillDocumentSchema>;
export type CreateSkillDocumentInput = z.infer<typeof createSkillDocumentInputSchema>;
export type SkillDiscoveryResult = z.infer<typeof skillDiscoveryResultSchema>;

type SkillMarkdownParts = {
  body: string;
  frontmatter: string;
};

function splitSkillMarkdown(content: string): SkillMarkdownParts {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/,
  );
  if (match === null) {
    throw new Error("SKILL.md 必须以 YAML frontmatter 开头和结尾。");
  }
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function parseFrontmatter(frontmatter: string) {
  const document = parseDocument(frontmatter);
  const yamlError = document.errors[0];
  if (yamlError !== undefined) {
    throw new Error(`SKILL.md YAML 无效：${yamlError.message}`);
  }
  const parsed = skillMetadataSchema.safeParse(document.toJS());
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "SKILL.md 元信息无效。");
  }
  return { document, metadata: { name: parsed.data.name, description: parsed.data.description } };
}

export function parseSkillMarkdown(content: string): {
  body: string;
  metadata: Pick<SkillMetadata, "description" | "name">;
} {
  const parts = splitSkillMarkdown(content);
  const { metadata } = parseFrontmatter(parts.frontmatter);
  if (parts.body.trim().length === 0) {
    throw new Error("SKILL.md 必须包含 Markdown 指令正文。");
  }
  return { body: parts.body, metadata };
}

export function createSkillMarkdown(
  metadata: Pick<SkillMetadata, "description" | "name">,
  body = "# Instructions\n\n在这里编写 Agent 应遵循的工作流程。\n",
): string {
  const parsed = skillMetadataSchema.parse(metadata);
  return `---\nname: ${parsed.name}\ndescription: ${JSON.stringify(parsed.description)}\n---\n\n${body.trim()}\n`;
}

export function updateSkillMarkdownMetadata(
  content: string,
  metadata: Pick<SkillMetadata, "description" | "name">,
): string {
  const parsedMetadata = skillMetadataSchema.parse(metadata);
  const parts = splitSkillMarkdown(content);
  const { document } = parseFrontmatter(parts.frontmatter);
  document.set("name", parsedMetadata.name);
  document.set("description", parsedMetadata.description);
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${parts.body}`;
}
