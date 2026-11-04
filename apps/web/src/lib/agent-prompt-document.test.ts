import { describe, expect, it } from "vitest";

import { parseAgentPromptDocument, serializeAgentPromptDocument } from "./agent-prompt-document.js";

const AGENT = {
  description: "负责实现与验证。",
  instructions: "# 工作方式\n\n先核对项目事实。",
  name: "实现 Agent",
  role: "通用执行",
};

describe("Agent prompt Markdown document", () => {
  it("serializes profile properties into YAML frontmatter", () => {
    expect(serializeAgentPromptDocument(AGENT)).toBe(
      "---\nname: 实现 Agent\nrole: 通用执行\ndescription: 负责实现与验证。\n---\n# 工作方式\n\n先核对项目事实。",
    );
  });

  it("updates profile properties and prompt body from Markdown", () => {
    expect(parseAgentPromptDocument(
      "---\nname: 实施 Agent\nrole: 开发执行\ndescription: 负责最小实现。\n---\n# 指令\n\n完成后验证。",
      AGENT,
    )).toEqual({
      description: "负责最小实现。",
      instructions: "# 指令\n\n完成后验证。",
      name: "实施 Agent",
      role: "开发执行",
    });
  });

  it("keeps existing properties when a document has no frontmatter", () => {
    expect(parseAgentPromptDocument("只更新正文。", AGENT)).toEqual({
      ...AGENT,
      instructions: "只更新正文。",
    });
  });
});
