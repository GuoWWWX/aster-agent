import { describe, expect, it } from "vitest";

import {
  BASE_SYSTEM_PROMPT,
  CONTEXT_COMPACTION_PROMPT,
} from "./prompt-assets.js";

describe("prompt assets", () => {
  it("loads the stable base prompt from bundled Markdown", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("You are a local coding Agent.");
    expect(BASE_SYSTEM_PROMPT).toContain("# Response Language");
    expect(BASE_SYSTEM_PROMPT).toContain("# Commands and Task Management");
    expect(BASE_SYSTEM_PROMPT).toContain("# Conflict Recovery");
    expect(BASE_SYSTEM_PROMPT).toContain(
      "The application language is Simplified Chinese (zh-CN).",
    );
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/\p{Script=Han}/u);
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/\r/u);
  });

  it("loads the strict context compaction prompt from bundled Markdown", () => {
    expect(CONTEXT_COMPACTION_PROMPT).toContain("Return strict JSON");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("# Output Contract");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("# Preservation Rules");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("`artifactRefs`");
    expect(CONTEXT_COMPACTION_PROMPT).not.toMatch(/\p{Script=Han}/u);
  });
});
