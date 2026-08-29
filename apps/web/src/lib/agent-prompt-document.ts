import type { AgentProfile } from "@agent/protocol";

import { parseYamlFrontmatter } from "./markdown-frontmatter.js";

type AgentPromptDocumentFields = Pick<AgentProfile, "description" | "instructions" | "name" | "role">;

const AGENT_PROMPT_PROPERTY_KEYS = ["name", "role", "description"] as const;

function propertyValue(source: string): string {
  return source.replace(/\r?\n/gu, " ").trim();
}

function frontmatterValue(
  frontmatter: ReturnType<typeof parseYamlFrontmatter>,
  key: typeof AGENT_PROMPT_PROPERTY_KEYS[number],
): string | undefined {
  const entry = frontmatter?.entries.find((candidate) => (
    candidate.key.toLocaleLowerCase("en-US") === key
  ));
  if (entry === undefined) return undefined;
  return Array.isArray(entry.value) ? entry.value.join(", ") : entry.value;
}

/** 将结构化 Agent 属性投影为可编辑的 Markdown 文档属性与正文。 */
export function serializeAgentPromptDocument(agent: AgentPromptDocumentFields): string {
  const properties = AGENT_PROMPT_PROPERTY_KEYS.map((key) => `${key}: ${propertyValue(agent[key])}`);
  return `---\n${properties.join("\n")}\n---\n${agent.instructions}`;
}

/** 读取 Markdown 属性；缺失属性沿用原 Agent 值，让用户只编辑提示词正文时不会丢资料。 */
export function parseAgentPromptDocument(
  source: string,
  fallback: AgentPromptDocumentFields,
): AgentPromptDocumentFields {
  const frontmatter = parseYamlFrontmatter(source);
  if (frontmatter === undefined) return { ...fallback, instructions: source };

  return {
    description: frontmatterValue(frontmatter, "description") ?? fallback.description,
    instructions: frontmatter.markdown,
    name: frontmatterValue(frontmatter, "name") ?? fallback.name,
    role: frontmatterValue(frontmatter, "role") ?? fallback.role,
  };
}
