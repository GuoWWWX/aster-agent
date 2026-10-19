export type AgentToolRole = "conversation" | "quick_coordinator" | "subagent" | "team_coordinator" | "team_lead" | "team_member";

const taskReads = ["list_task_contexts", "get_task_context", "link_task_context"];
const conversationReads = ["list_agent_conversations", "read_agent_conversation"];
const fileReads = ["read_file", "search_text", "find_files", "read_external_file", "read_attachment", "view_attachments"];
const checklist = ["update_task_list", "close_task_list"];
const questions = ["request_user_input", "wait_for_user_input"];
const subagents = ["spawn_subagent", "list_subagents", "wait_for_subagents", "end_subagent", "list_models"];
const communication = ["send_agent_message", "wait_for_agent_message"];
const skills = ["load_skill", "read_skill_reference"];
const execution = ["create_skill", "write_file", "replace_in_file", "apply_patch", "delete_file", "run_command", "read_command_output",
  "list_background_commands", "stop_command", "list_project_operations", "wait_for_project_operation", "terminal_control", "browser_control", "computer_use", "web_search", "present_html"];

const roleTools = {
  conversation: null,
  team_member: null,
  subagent: new Set([...fileReads, ...execution, ...skills, ...taskReads, ...conversationReads, ...checklist, ...questions]),
  quick_coordinator: new Set([...fileReads, ...taskReads, ...conversationReads, ...checklist, ...questions, ...subagents, ...communication,
    "update_task_context", "list_pending_messages", "claim_pending_messages", "present_html"]),
  team_lead: new Set([...fileReads, ...taskReads, ...conversationReads, ...checklist, ...questions, ...communication, ...skills,
    "update_task_context", "read_team_messages", "post_team_message", "get_team_context", "resize_team_workers", "set_team_collaboration_plan", "web_search", "present_html"]),
  team_coordinator: new Set(["select_team_chat_members", "read_team_messages", ...conversationReads, "list_task_contexts", "get_task_context"]),
} satisfies Record<AgentToolRole, ReadonlySet<string> | null>;

export function toolsForAgentRole(role: AgentToolRole): ReadonlySet<string> | null { return roleTools[role]; }

const roleInstructions: Record<AgentToolRole, string> = {
  conversation: "Handle the current request directly. Delegate only useful independent work; do not create workers or task records for ordinary conversation.",
  quick_coordinator: "Coordinate the user's independent requests. Maintain their persistent task records, hand work to reusable Subagents, claim queued requests only after successful handoff, and deliver verified results. Implementation, commands, browser work and file changes belong to the workers; do not perform a second implementation yourself. Read their evidence only when needed. Reuse completed receipts, queue independent follow-ups to a busy child, and do not dispatch the same assignment twice.",
  subagent: "Execute only your assigned scope. The parent owns delegation and the persistent task list: do not create more workers or create/update its overall task records. Read relevant task context and link evidence when needed; a local execution checklist is available for your own steps. Return a concise result and actual verification through the existing completion receipt. Do not repeat completed work or send receipt acknowledgements.",
  team_coordinator: "Only route group messages. Read public discussion, task references and member information as needed, then select recipients once for the current request. Do not implement, run commands, change files, maintain task state, dispatch private assignments or publish a member reply. The selected leader/member owns those actions. Use the provided profiles before reading more history; successful selection is the dispatch receipt, not a reason to send another message.",
  team_lead: "Own task reuse, scope, named responsibilities, public delegation, verification and final delivery. Implementation, command execution, browser checks and file changes belong to the assigned members; do not edit or rebuild their work yourself. Review their evidence, ask for missing verification or original file references, and publish only the necessary delivery or synthesis. Dispatch each assignment once through one channel; do not repeat a member's complete public answer.",
  team_member: "Use your configured Agent identity and this team's assigned responsibility. Execute your own scope, communicate dependencies with the relevant members, and publish important milestones, blockers and shared decisions. Reuse the existing task and link your evidence instead of creating another overall task or rewriting the leader's summary. Only a directly assigned independent goal without an existing owner needs your own task record. Let the leader deliver complex combined work.",
};

export function agentToolRoleInstructions(role: AgentToolRole): string {
  return `[Current tool role: ${role}]\n${roleInstructions[role]}\nUse only tools advertised in this request. An unavailable tool name is not an invitation to probe aliases or bypass the role. Update task state only when it materially changes; a successful completion request awaiting user confirmation needs no second update.`;
}
