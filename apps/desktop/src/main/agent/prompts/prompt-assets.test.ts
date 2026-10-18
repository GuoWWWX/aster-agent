import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "@agent/protocol";

import {
  BASE_SYSTEM_PROMPT,
  baseSystemPromptForTools,
  BROWSER_USE_SKILL,
  CONTEXT_COMPACTION_PROMPT,
  TEAM_CHAT_COORDINATOR_PROMPT,
  SYSTEM_SKILLS,
} from "./prompt-assets.js";

describe("prompt assets", () => {
  it("routes collective greetings to everyone and discussions to relevant members without making the lead the default speaker", () => {
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("select ALL active members");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("Do not use the leader as the default spokesperson");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("Select multiple relevant members");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("select ONLY the active team leader by default");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).not.toContain("Greetings and casual discussion need one relevant responder");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).not.toContain("Choose multiple members only when their distinct contributions are requested");
  });

  it("preserves a recent addressee on follow-ups and uses the lead only for unresolved routing", () => {
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("Preserve the active conversational addressee");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("A different technical subject or an additional specialist perspective alone does not clear that addressee");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("An explicit change of audience or a clearly independent new request resets the previous addressee");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("only if responsibility remains genuinely unclear");
    expect(TEAM_CHAT_COORDINATOR_PROMPT).toContain("Keep the current addressee and topic in contextSummary");
  });

  it("keeps delegation constraints and repository-aware command guidance available with skills enabled", () => {
    const prompt = baseSystemPromptForTools(new Set(["spawn_subagent", "run_command", "load_skill"]));
    expect(prompt).toContain("does not inherit the parent conversation's history");
    expect(prompt).toContain("relevant user constraints");
    expect(prompt).toContain("workspace is a Git repository");
    expect(prompt).toContain("Do not use repeated Git flags");
    expect(prompt).toContain("A running batch command holds the project mutation lock");
  });

  it("omits unavailable execution, task-ownership and group instructions from routing prompts", () => {
    const prompt = baseSystemPromptForTools(new Set(["select_team_chat_members", "read_team_messages"]));
    expect(prompt).toContain("# Response Language");
    expect(prompt).not.toContain("post_team_message");
    for (const heading of ["# Persistent Tasks", "# Group Collaboration", "# Command and Terminal Choice", "# Files and Search", "# File Changes", "# Subagent Collaboration", "# Browser Choice"]) {
      expect(prompt).not.toContain(heading);
    }
  });

  it("keeps read and delivery guidance without shell or child-queue instructions for a team lead", () => {
    const prompt = baseSystemPromptForTools(new Set(["read_file", "present_html", "send_agent_message", "post_team_message", "update_task_context"]));
    expect(prompt).toContain("# Workspace Context");
    expect(prompt).toContain("# HTML Presentations");
    expect(prompt).toContain("# Group Collaboration");
    expect(prompt).not.toContain("# Files and Search");
    expect(prompt).not.toContain("# Queued Subagent Followups");
  });
  it("lets the runtime bind the current task source instead of asking the model to invent IDs", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("create one by omitting id and expectedRevision");
    expect(BASE_SYSTEM_PROMPT).toContain("omit source so the runtime binds its real original message");
    expect(BASE_SYSTEM_PROMPT).toContain("never invent conversation/message IDs or use placeholders");
    expect(BASE_SYSTEM_PROMPT).toContain("Explicitly select an actual source when distinguishing earlier or independent requests");
    expect(BASE_SYSTEM_PROMPT).toContain("correct the arguments and retry before delegating that goal");
  });
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
    expect(BASE_SYSTEM_PROMPT).toContain("# HTML Presentations");
    expect(BASE_SYSTEM_PROMPT).toContain("call `present_html` with the existing entry file's workspace-relative `path`");
    expect(BASE_SYSTEM_PROMPT).toContain("File-edit tool records show only their diffs");
    expect(BASE_SYSTEM_PROMPT).toContain("Once the HTML code block is complete, it displays a preview by default");
    expect(BASE_SYSTEM_PROMPT).toContain("preview/source panel before the final explanation");
    expect(BASE_SYSTEM_PROMPT).toContain("Place final inline HTML deliverables before their explanatory text");
    expect(BASE_SYSTEM_PROMPT).toContain("# Conflict Recovery");
    expect(BASE_SYSTEM_PROMPT).toContain(
      "The application language is Simplified Chinese (zh-CN).",
    );
    expect(BASE_SYSTEM_PROMPT).toContain(
      "Use `run_command` with its default `batch` mode for every finite non-interactive command",
    );
    expect(BASE_SYSTEM_PROMPT).toContain("Use `run_command` with `mode=service` only");
    expect(BASE_SYSTEM_PROMPT).toContain("may return `running` with a `commandId`");
    expect(BASE_SYSTEM_PROMPT).toContain("call `read_command_output` with that same ID");
    expect(BASE_SYSTEM_PROMPT).toContain("Reuse the returned output offsets");
    expect(BASE_SYSTEM_PROMPT).not.toContain("tool returns to you only after the process really exits");
    expect(BASE_SYSTEM_PROMPT).not.toContain("all results return before you continue analysis");
    expect(BASE_SYSTEM_PROMPT).toContain("do not wait for a service to exit");
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

  it("allows inline HTML fragments without requiring files or document wrappers", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("output an `html` fenced code block directly");
    expect(BASE_SYSTEM_PROMPT).toContain("even a single `<div>`");
    expect(BASE_SYSTEM_PROMPT).toContain("`<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>` wrappers are not required");
    expect(BASE_SYSTEM_PROMPT).toContain("Create or edit files according to the user's needs and task; inline rendering does not require an HTML file");
    expect(BASE_SYSTEM_PROMPT).not.toContain("one complete `html` fenced code block");
    expect(BASE_SYSTEM_PROMPT).not.toContain("finish creating and verifying its files first");
    expect(BASE_SYSTEM_PROMPT).toContain("multiple page or component designs to compare and choose");
    expect(BASE_SYSTEM_PROMPT).toContain("prefer one paginated `present_html` delivery with `pages`");
    expect(BASE_SYSTEM_PROMPT).toContain('each `{title, kind:"code", html}`');
    expect(BASE_SYSTEM_PROMPT).toContain("automatically group unrelated pages");
    expect(BASE_SYSTEM_PROMPT).toContain("Keep all options in a comparison at the same intended preview height");
  });

  it("loads the bundled browser Skill", () => {
    expect(BROWSER_USE_SKILL).toContain("name: browser-use");
    expect(BROWSER_USE_SKILL).toContain("single `browser_control` tool");
    expect(BROWSER_USE_SKILL).toContain("Perform one state-changing action, then observe or screenshot again");
    expect(BROWSER_USE_SKILL).toContain("`click` performs real browser pointer input");
    expect(BROWSER_USE_SKILL).not.toMatch(/\r/u);
  });

  it("limits workspace discovery and uses the built-in static HTML preview", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Do not routinely inspect the workspace for ordinary questions");
    expect(BASE_SYSTEM_PROMPT).toContain("The authorized workspace root is already supplied");
    expect(BASE_SYSTEM_PROMPT).toContain("Get-ChildItem -LiteralPath src -Name");
    expect(BASE_SYSTEM_PROMPT).toContain("`ls -A`");
    expect(BASE_SYSTEM_PROMPT).toContain("`rg --files -g");
    expect(BASE_SYSTEM_PROMPT).toContain("`rg -n");
    expect(BASE_SYSTEM_PROMPT).toContain("Do not start Python, http.server, or another ad hoc server just to display static HTML");
    expect(BASE_SYSTEM_PROMPT).toContain("application's own isolated preview server");
    expect(BASE_SYSTEM_PROMPT).not.toContain("list_directory");
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
