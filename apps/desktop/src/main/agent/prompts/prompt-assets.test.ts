import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "@agent/protocol";

import {
  BASE_SYSTEM_PROMPT,
  BROWSER_USE_SKILL,
  CONTEXT_COMPACTION_PROMPT,
  SYSTEM_SKILLS,
} from "./prompt-assets.js";

describe("prompt assets", () => {
  it("bundles distinct, valid system skills", () => {
    const names = SYSTEM_SKILLS.map((content) => parseSkillMarkdown(content).metadata.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["browser-use", "image-view", "code-review", "debugging"]);
  });
  it("loads the stable base prompt from bundled Markdown", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("You are a local coding Agent.");
    expect(BASE_SYSTEM_PROMPT).toContain("# Response Language");
    expect(BASE_SYSTEM_PROMPT).toContain("# Commands and Task Management");
    expect(BASE_SYSTEM_PROMPT).toContain("# Command and Terminal Choice");
    expect(BASE_SYSTEM_PROMPT).toContain("# Browser Choice");
    expect(BASE_SYSTEM_PROMPT).toContain("# Conflict Recovery");
    expect(BASE_SYSTEM_PROMPT).toContain(
      "The application language is Simplified Chinese (zh-CN).",
    );
    expect(BASE_SYSTEM_PROMPT).toContain(
      "Use `run_command` with its default `batch` mode for every finite non-interactive command",
    );
    expect(BASE_SYSTEM_PROMPT).toContain("Use `run_command` with `mode=service` only");
    expect(BASE_SYSTEM_PROMPT).toContain(
      "A terminal tab opened manually by the user is not automatically owned by this conversation",
    );
    expect(BASE_SYSTEM_PROMPT).toContain("Pass `expectedContext=ssh` with every later remote command");
    expect(BASE_SYSTEM_PROMPT).toContain("successful empty result when nothing matches");
    expect(BASE_SYSTEM_PROMPT).toContain("prefer `replace_in_file`");
    expect(BASE_SYSTEM_PROMPT).toContain("standard `---/+++` unified diff");
    expect(BASE_SYSTEM_PROMPT).toContain("`*** Update File: <path>`");
    expect(BASE_SYSTEM_PROMPT).toContain("successful build alone does not verify functional behavior");
    expect(BASE_SYSTEM_PROMPT).toContain("combining changes into one call");
    expect(BASE_SYSTEM_PROMPT).toContain("`update_task_list` creates or updates");
    expect(BASE_SYSTEM_PROMPT).not.toContain("create_task_list");
    expect(BASE_SYSTEM_PROMPT).not.toContain("at most one running");
    expect(BASE_SYSTEM_PROMPT).toContain("returns only a bounded completion receipt");
    expect(BASE_SYSTEM_PROMPT).toContain("load the `browser-use` Skill when it is present");
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/\p{Script=Han}/u);
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/\r/u);
  });

  it("loads the bundled browser Skill", () => {
    expect(BROWSER_USE_SKILL).toContain("name: browser-use");
    expect(BROWSER_USE_SKILL).toContain("single `browser_control` tool");
    expect(BROWSER_USE_SKILL).toContain("Perform one state-changing action, then observe or screenshot again");
    expect(BROWSER_USE_SKILL).toContain("`click` performs real browser pointer input");
    expect(BROWSER_USE_SKILL).not.toMatch(/\r/u);
  });

  it("loads the strict context compaction prompt from bundled Markdown", () => {
    expect(CONTEXT_COMPACTION_PROMPT).toContain("Return strict JSON");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("# Output Contract");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("# Preservation Rules");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("`artifactRefs`");
    expect(CONTEXT_COMPACTION_PROMPT).toContain("[Agent input: ...]");
    expect(CONTEXT_COMPACTION_PROMPT).not.toMatch(/\p{Script=Han}/u);
  });
});
