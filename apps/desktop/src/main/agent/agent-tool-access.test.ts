import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import type { CompleteTurnInput, ModelProviderAdapter } from "../model/model-contracts.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";

type Role = "ordinary" | "quick" | "subagent" | "lead" | "member" | "coordinator";
async function fixture(role: Role, model: ModelProviderAdapter) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-tool-scope-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(root);
  const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
  database.syncTeamDirectory(directory);
  const tools = new ProjectToolRegistry(projects);
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid", modelId: "fixture", reasoningOptions: [] }) }, projects, tools, model,
    undefined, undefined, null, null, { getConfiguration: () => directory });
  let conversation = database.createConversation(project.id);
  if (role === "quick") database.setConversationPermissionMode(conversation.id, "full_access", "parallel_queue");
  if (role === "subagent") conversation = database.forkConversation(conversation.id, "subagent");
  if (["lead", "member", "coordinator"].includes(role)) {
    const instance = database.createTeamInstance({ teamId: "default-team", scope: "project", projectId: project.id });
    const lead = database.createConversation(project.id, { teamId: instance.teamId, threadKind: "team_lead" });
    database.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId, teamInstanceId: instance.id, projectId: project.id, sourceConversationId: null });
    database.setTeamInstanceRoot(instance.id, lead.id);
    if (role === "lead") conversation = lead;
    if (role === "member") {
      const agent = directory.agents.find(agent => agent.id === directory.teams[0]?.memberIds.find(id => id !== directory.teams[0]?.leadAgentId))!;
      conversation = database.createConversation(project.id, { teamId: instance.teamId, threadKind: "agent", parentConversationId: lead.id,
        agent: { id: agent.id, name: agent.name, role: agent.role, instructions: agent.instructions, isDefault: agent.isDefault, avatarIcon: "bot" } });
      database.bindTeamMemberConversation({ agentId: agent.id, conversationId: conversation.id, teamExecutionConversationId: lead.id });
    }
    if (role === "coordinator") conversation = runtime.getTeamChatCoordinationConversation({ teamInstanceId: instance.id });
  }
  return { database, tools, runtime, conversation, dispose: async () => {
    await runtime.stopAllRuns(); database.close(); await rm(root, { recursive: true, force: true });
  } };
}

it.each([
  { role: "ordinary", yes: ["run_command", "write_file", "spawn_subagent", "update_task_context"], no: ["post_team_message", "claim_pending_messages"] },
  { role: "quick", yes: ["spawn_subagent", "claim_pending_messages", "send_agent_message", "update_task_context", "read_file"], no: ["run_command", "write_file", "web_search"] },
  { role: "subagent", yes: ["run_command", "write_file", "link_task_context", "update_task_list"], no: ["update_task_context", "post_team_message", "claim_pending_messages", "spawn_subagent", "wait_for_subagents", "list_models"] },
  { role: "lead", yes: ["post_team_message", "send_agent_message", "update_task_context", "read_file"], no: ["write_file", "run_command", "spawn_subagent"] },
  { role: "member", yes: ["post_team_message", "send_agent_message", "write_file", "run_command"], no: ["spawn_subagent", "resize_team_workers", "select_team_chat_members"] },
  { role: "coordinator", yes: ["select_team_chat_members", "read_team_messages", "list_task_contexts", "get_task_context", "list_agent_conversations", "read_agent_conversation"], no: ["run_command", "write_file", "update_task_context", "send_agent_message", "spawn_subagent", "post_team_message"] },
] satisfies Array<{ role: Role; yes: string[]; no: string[] }>)('advertises tools for $role without conflicting execution instructions', async ({ role, yes, no }) => {
  let request: CompleteTurnInput | undefined;
  const f = await fixture(role, { completeTurn: input => { request = input; return Promise.resolve({ content: "已检查", finishReason: "stop", toolCalls: [] }); } });
  try {
    f.runtime.sendMessage({ conversationId: f.conversation.id, content: "检查当前职责", permissionMode: "full_access" }, () => undefined);
    await vi.waitFor(() => expect(f.database.getConversation(f.conversation.id).activeRunId).toBeNull());
    const names = request?.tools.map(tool => tool.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(yes));
    for (const name of no) expect(names).not.toContain(name);
    if (role === "coordinator") expect(names).toHaveLength(6);
    const prompt = request?.messages[0]?.content ?? "";
    if (["quick", "lead", "coordinator"].includes(role)) expect(prompt).not.toContain("# Command and Terminal Choice");
    if (role === "subagent") {
      expect(prompt).not.toContain("# Persistent Tasks");
      expect(prompt).not.toContain("wait_for_subagents");
      expect(prompt).not.toContain("post_team_message");
    }
    if (["ordinary", "quick", "subagent", "coordinator"].includes(role)) expect(prompt).not.toContain("# Group Collaboration");
  } finally { await f.dispose(); }
});

it.each<Role>(["quick", "lead", "coordinator"])('rejects an unadvertised write for %s before the file handler runs', async role => {
  let turns = 0;
  const f = await fixture(role, { completeTurn: () => Promise.resolve(++turns === 1
    ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: "forbidden-write", name: "write_file", arguments: '{"path":"unexpected.txt","content":"must not write"}' }] }
    : { content: "按本轮职责结束", finishReason: "stop", toolCalls: [] }) });
  const execute = vi.spyOn(f.tools, "execute");
  try {
    f.runtime.sendMessage({ conversationId: f.conversation.id, content: "检查身份限制", permissionMode: "full_access" }, () => undefined);
    await vi.waitFor(() => expect(f.database.getConversation(f.conversation.id).activeRunId).toBeNull());
    expect(execute).not.toHaveBeenCalled();
    expect(f.database.listTimeline(f.conversation.id).find(item => item.kind === "tool" && item.name === "write_file"))
      .toMatchObject({ status: "failed" });
  } finally { await f.dispose(); }
});
