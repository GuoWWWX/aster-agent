import baseSystemPromptSource from "./base-system.md";
import browserUseSkillSource from "./browser-use-skill.md";
import contextCompactionPromptSource from "./context-compaction.md";
import teamChatCoordinatorSource from "./team-chat-coordinator.md";
import imageViewSkillSource from "./skills/image-view/SKILL.md";
import codeReviewSkillSource from "./skills/code-review/SKILL.md";
import debuggingSkillSource from "./skills/debugging/SKILL.md";
import terminalUseSkillSource from "./skills/terminal-use/SKILL.md";
import uiVerificationSkillSource from "./skills/ui-verification/SKILL.md";
import skillCreatorSource from "./skills/skill-creator/SKILL.md";
import imagegenSource from "./skills/imagegen/SKILL.md";
import computerUseSource from "./skills/computer-use/SKILL.md";

function normalizePrompt(source: string): string {
  return source.trim().replace(/\r\n/gu, "\n");
}

export const BASE_SYSTEM_PROMPT = normalizePrompt(baseSystemPromptSource);
const sectionTools: Record<string, readonly string[]> = {
  "# HTML Presentations": ["present_html"],
  "# Quality and Verification": ["present_html", "write_file", "run_command"],
  "# Collaboration": ["send_agent_message"],
  "# Subagent Collaboration": ["spawn_subagent"],
  "# Queued Subagent Followups": ["send_agent_message"],
  "# Workspace Context": ["read_file"],
  "# Commands and Task Management": ["update_task_list"],
  "# Command and Terminal Choice": ["run_command"],
  "# Image Attachments": ["view_attachments"],
  "# Browser Choice": ["browser_control"],
  "# Files and Search": ["run_command"],
  "# File Changes": ["write_file"],
  "# Conflict Recovery": ["apply_patch", "run_command"],
  "# Persistent Tasks": ["update_task_context"],
  "# Group Collaboration": ["post_team_message"],
};

export function baseSystemPromptForTools(names: ReadonlySet<string>): string {
  return BASE_SYSTEM_PROMPT.split(/(?=^# )/mu).filter(section => {
    const heading = section.split("\n")[0] ?? "";
    if (heading === "# Queued Subagent Followups") return names.has("send_agent_message") && names.has("spawn_subagent");
    const required = sectionTools[heading];
    return required === undefined || required.some(name => names.has(name));
  }).join("").trim();
}
export const BROWSER_USE_SKILL = normalizePrompt(browserUseSkillSource);
export const SYSTEM_SKILLS = [BROWSER_USE_SKILL, imageViewSkillSource, codeReviewSkillSource, debuggingSkillSource, terminalUseSkillSource, uiVerificationSkillSource, skillCreatorSource, imagegenSource, computerUseSource].map(normalizePrompt);
export const CONTEXT_COMPACTION_PROMPT = normalizePrompt(contextCompactionPromptSource);
export const TEAM_CHAT_COORDINATOR_PROMPT = normalizePrompt(teamChatCoordinatorSource);
