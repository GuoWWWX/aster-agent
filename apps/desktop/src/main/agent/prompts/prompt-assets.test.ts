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
    expect(BASE_SYSTEM_PROMPT).toContain("updates:[{...}]");
    expect(BASE_SYSTEM_PROMPT).toContain("status, summary, decisions and nextStep belong in the same entry");
    expect(BASE_SYSTEM_PROMPT).toContain("Set close=true");
    expect(BASE_SYSTEM_PROMPT).toContain("A handoff that proceeds as planned needs no extra status-only update");
  });
  it("bundles distinct, valid system skills", () => {
    const names = SYSTEM_SKILLS.map((content) => parseSkillMarkdown(content).metadata.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["browser-use", "image-view", "code-review", "debugging", "terminal-use", "ui-verification", "skill-creator", "imagegen", "computer-use"]);
  });
  it("keeps concise core safety and execution contracts without duplicating specialist manuals", () => {
    for (const text of ["You are a local coding Agent.", "# Response Language", "# Work Progress", "# Quality and Verification",
      "# Commands and Task Management", "# Command and Terminal Choice", "# Browser Choice", "# File Changes", "# Conflict Recovery",
      "newest user request", "default batch mode", "running with a commandId", "same ID", "mode=service", "do not wait for a service to exit",
      "expectedContext=ssh", "prefer replace_in_file", "one existing file", "Combine all known step changes in one update_task_list call",
      "load the browser-use Skill", "The application language is Simplified Chinese (zh-CN)."]) expect(BASE_SYSTEM_PROMPT).toContain(text);
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/\p{Script=Han}|\r/u);
    expect(BASE_SYSTEM_PROMPT).not.toContain("at most one running");
    expect(BASE_SYSTEM_PROMPT).toContain("Reuse images already visible");
    expect(BASE_SYSTEM_PROMPT).toContain("terminal-use");
    expect(BASE_SYSTEM_PROMPT).toContain("Do not repeat unchanged searches or reads");
    expect(BASE_SYSTEM_PROMPT).toContain("For complex tasks, plan around the user's goal");
    expect(BASE_SYSTEM_PROMPT).toContain("verify behavior and details with relevant tests");
  });
  it("supports self-contained framework snippets and inspection before a single final delivery", () => {
    for (const text of ["html, react/jsx/tsx or vue", "HTML/SVG fragments", "no document wrappers or file",
      "default-exported component", "Vue uses a self-contained SFC", "existing HTML file", "workspace-relative path",
      "requested alternatives", "one delivery channel", "rendered pixels"]) expect(BASE_SYSTEM_PROMPT).toContain(text);
    const visualSkill = SYSTEM_SKILLS.find(source => parseSkillMarkdown(source).metadata.name === "ui-verification")!;
    expect(visualSkill).toContain("Preserve the requested format and constraints");
    expect(visualSkill).toContain("Source code and a successful build are not visual evidence");
    expect(visualSkill).toContain("two distinct phases");
    expect(visualSkill).toContain("sourceRef");
    const terminalSkill = SYSTEM_SKILLS.find(source => parseSkillMarkdown(source).metadata.name === "terminal-use")!;
    expect(terminalSkill).toContain("expectedContext=ssh");
    expect(terminalSkill).toContain("NOT completion");
  });
  it("loads the bundled browser Skill", () => {
    expect(BROWSER_USE_SKILL).toContain("name: browser-use");
    expect(BROWSER_USE_SKILL).toContain("single `browser_control` tool");
    expect(BROWSER_USE_SKILL).toContain("Perform one state-changing action, then observe or screenshot again");
    expect(BROWSER_USE_SKILL).toContain("`click` performs real browser pointer input");
    expect(BROWSER_USE_SKILL).not.toMatch(/\r/u);
  });

  it("limits discovery and keeps isolated previews separate from an application's dev service", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Do not routinely inspect the workspace");
    expect(BASE_SYSTEM_PROMPT).toContain("The authorized workspace root is already supplied");
    expect(BASE_SYSTEM_PROMPT).toContain("Scope find_files/search_text");
    expect(BASE_SYSTEM_PROMPT).toContain("one-time approval outside the workspace");
    expect(BASE_SYSTEM_PROMPT).toContain("isolated preview server");
    expect(BASE_SYSTEM_PROMPT).toContain("not an ad hoc static server");
    const ordinary = baseSystemPromptForTools(new Set(["run_command", "write_file", "present_html", "load_skill", "spawn_subagent", "send_agent_message", "read_file", "update_task_context", "update_task_list", "browser_control"]));
    expect(ordinary.length).toBeLessThan(16000);
    expect(ordinary).not.toContain("# Group Collaboration");
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
