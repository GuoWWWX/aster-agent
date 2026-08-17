import { describe, expect, it } from "vitest";

import {
  createSkillMarkdown,
  parseSkillMarkdown,
  updateSkillMarkdownMetadata,
} from "./skill-document.js";

describe("skill document", () => {
  it("parses required YAML metadata and Markdown instructions", () => {
    const parsed = parseSkillMarkdown(`---\nname: code-review\ndescription: Review changes safely.\n---\n\n# Workflow\n\nReview the diff.\n`);

    expect(parsed.metadata).toEqual({
      description: "Review changes safely.",
      name: "code-review",
    });
    expect(parsed.body).toContain("# Workflow");
  });

  it("updates required metadata without removing additional frontmatter", () => {
    const updated = updateSkillMarkdownMetadata(
      `---\nname: old-name\ndescription: Old description.\nlicense: MIT\n---\n\n# Workflow\n`,
      { description: "New description.", name: "new-name" },
    );

    expect(updated).toContain("name: new-name");
    expect(updated).toContain("description: New description.");
    expect(updated).toContain("license: MIT");
    expect(updated).toContain("# Workflow");
  });

  it("rejects JSON-only content and missing instructions", () => {
    expect(() => parseSkillMarkdown('{"name":"review"}')).toThrow(/frontmatter/);
    expect(() => parseSkillMarkdown("---\nname: review\ndescription: Review code.\n---\n")).toThrow(/指令正文/);
  });

  it("creates a valid SKILL.md template", () => {
    const content = createSkillMarkdown({
      description: "Use when reviewing code changes.",
      name: "code-review",
    });

    expect(parseSkillMarkdown(content).metadata.name).toBe("code-review");
  });
});
