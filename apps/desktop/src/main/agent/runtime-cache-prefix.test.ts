import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { AgentRuntime } from "./agent-runtime.js";
import type { CompleteTurnInput, ModelConfiguration } from "../model/model-contracts.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-cache-prefix-"));
  const db = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(db);
  const project = await projects.registerDirectory(root);
  const log = new ThreadLog(path.join(root, "conversations"));
  const lifecycle = new ConversationLifecycleService(db, log, new EventProjector(db, log));
  const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
  db.syncTeamDirectory(directory);
  const instance = db.createTeamInstance({ teamId: "default-team", scope: "project", projectId: project.id });
  const lead = lifecycle.createConversation(project.id, { teamId: "default-team", threadKind: "team_lead",
    agent: { id: "team-lead", name: "Lead", role: "lead", instructions: "", isDefault: false } });
  db.bindTeamExecutionConversation({ conversationId: lead.id, teamId: "default-team", teamInstanceId: instance.id, projectId: project.id, sourceConversationId: null });
  db.setTeamInstanceRoot(instance.id, lead.id);
  const createMember = (name: string, agentId = "requirements-analyst") => {
    const member = lifecycle.createConversation(project.id, { teamId: "default-team", threadKind: "agent", parentConversationId: lead.id,
      agent: { id: agentId, name, role: "requirements", instructions: "", isDefault: false } });
    db.bindTeamMemberConversation({ conversationId: member.id, agentId, teamExecutionConversationId: lead.id });
    return member;
  };
  const member = createMember("Analyst one");
  const requests: CompleteTurnInput[] = [];
  const model = { completeTurn(input: CompleteTurnInput) {
    requests.push(input);
    if (input.tools.some(tool => tool.name === "select_team_chat_members")) {
      const reference = input.messages.findLast(message => message.content.startsWith("[群聊协调参考上下文"));
      const context = z.object({ message: z.object({ id: z.string() }).nullable() }).parse(JSON.parse(reference?.content.split("\n")[1] ?? "null"));
      if (context.message !== null) {
        const id = `route-${context.message.id}`;
        if (!input.messages.some(message => message.toolCallId === id)) return Promise.resolve({ content: "", finishReason: "tool_calls",
          toolCalls: [{ id, name: "select_team_chat_members", arguments: JSON.stringify({ messageId: context.message.id, recipientConversationIds: [member.id], audience: "replace", decisionSummary: "Member reply" }) }] });
      }
    }
    return Promise.resolve({ content: "ok", finishReason: "stop", toolCalls: [] });
  } };
  const tools = new ProjectToolRegistry(projects);
  const runtime = new AgentRuntime(db, { getConfiguration: (): ModelConfiguration => ({ apiFormat: "openai-responses", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] }) },
    projects, tools, model, undefined, undefined, null, null, { getConfiguration: () => directory }, null, null, undefined, null, log, new EventProjector(db, log));
  runtime.setTeamWorkItemDispatcher({ submit() { throw new Error("No dispatch is expected in a cache test."); } });
  const send = async (id: string, content: string) => {
    await new Promise<void>(resolve => runtime.sendMessage({ conversationId: id, content, permissionMode: "full_access" }, event => {
      if (event.type === "run.finished" && event.conversationId === id) resolve();
    }));
    await vi.waitFor(() => expect(db.getConversation(id).activeRunId).toBeNull());
    return requests.findLast(input => input.cacheKey === `aster:${id}`)!;
  };
  return { db, log, instance, lead, member, createMember, requests, runtime, lifecycle, send, async dispose() {
    await runtime.stopAllRuns(); await tools.dispose(); db.close(); await rm(root, { recursive: true, force: true });
  } };
}

it("reuses the group's own coordinator history and cache scope while its discussion reference changes", async () => {
  const f = await fixture();
  try {
    const coordinator = f.runtime.getTeamChatCoordinationConversation({ teamInstanceId: f.instance.id });
    const firstGroup = f.runtime.postTeamChat({ teamInstanceId: f.instance.id, content: "route first", requestId: randomUUID() }, () => {});
    await vi.waitFor(() => expect(f.db.collaboration.message(firstGroup.id).coordinator?.status).toBe("completed"));
    const first = f.requests.findLast(input => input.cacheKey === `aster:${coordinator.id}`)!;
    const nextGroup = f.runtime.postTeamChat({ teamInstanceId: f.instance.id, content: "route second", requestId: randomUUID() }, () => {});
    await vi.waitFor(() => expect(f.db.collaboration.message(nextGroup.id).coordinator?.status).toBe("completed"));
    const second = f.requests.findLast(input => input.cacheKey === first.cacheKey)!;
    expect(second.messages[0]).toEqual(first.messages[0]);
    expect(second.tools).toEqual(first.tools);
    const stable = first.messages.filter(message => message.runtimeContext === undefined);
    const firstUser = stable.findIndex(message => message.role === "user" && message.content === "route first");
    expect(firstUser).toBeGreaterThan(0);
    expect(second.messages.filter(message => message.runtimeContext === undefined).slice(0, firstUser + 1)).toEqual(stable.slice(0, firstUser + 1));
    expect(second.messages.findLast(message => message.runtimeContext === "directory")?.content).toContain("route second");
    expect(second.cacheKey).not.toBe(`aster:${f.member.id}`);
  } finally { await f.dispose(); }
});

it.each(["lead", "member"] as const)("keeps the %s system and tool prefix stable when switching group and private work", async role => {
  const f = await fixture();
  const target = f[role];
  try {
    const first = await f.send(target.id, "private first");
    const group = f.runtime.postTeamChat({ teamInstanceId: f.instance.id, content: "group follow-up", recipientConversationIds: [target.id], requestId: randomUUID() }, () => {});
    await vi.waitFor(() => expect(f.db.collaboration.message(group.id).deliveries[0]?.status).toBe("completed"));
    const grouped = f.requests.findLast(input => input.cacheKey === `aster:${target.id}`)!;
    expect(grouped.messages[0]).toEqual(first.messages[0]);
    expect(grouped.tools).toEqual(first.tools);
    expect(grouped.messages.findLast(message => message.runtimeContext === "directory")?.content).toContain('"channel":"group"');
    const last = await f.send(target.id, "private again");
    expect(last.messages[0]).toEqual(first.messages[0]);
    expect(last.messages.findLast(message => message.runtimeContext === "directory")?.content).toContain('"channel":"private"');
    expect(last.messages.some(message => message.content === "private first")).toBe(true);
  } finally { await f.dispose(); }
});

it("moves changed member rosters to directory snapshots without invalidating the Team Lead system", async () => {
  const f = await fixture();
  try {
    const first = await f.send(f.lead.id, "first");
    const member = f.createMember("Architect", "solution-architect");
    const second = await f.send(f.lead.id, "follow-up");
    expect(second.messages[0]).toEqual(first.messages[0]);
    expect(second.messages[0]?.content).not.toContain(member.id);
    expect(second.messages.findLast(message => message.runtimeContext === "directory")?.content).toContain(member.id);
    expect(second.messages[0]?.content).toContain("must delegate to at least one durable member");
  } finally { await f.dispose(); }
});

it("keeps the main conversation prefix stable when visible Team instances are renamed", async () => {
  const f = await fixture();
  try {
    const main = f.lifecycle.createConversation(f.lead.projectId);
    const first = await f.send(main.id, "first");
    f.db.renameTeamInstance({ teamInstanceId: f.instance.id, name: "Renamed catalog entry" });
    const second = await f.send(main.id, "follow-up");
    expect(second.messages[0]).toEqual(first.messages[0]);
    expect(second.messages[0]?.content).not.toContain("Renamed catalog entry");
    expect(second.messages.findLast(message => message.runtimeContext === "directory")?.content).toContain("Renamed catalog entry");
    expect(second.messages[0]?.content).toContain("Only call submit_team_work_item when the user explicitly");
  } finally { await f.dispose(); }
});

it("keeps reusable Subagent history and cache scope isolated from changes in its parent", async () => {
  const f = await fixture();
  try {
    const parent = f.lifecycle.createConversation(f.lead.projectId);
    const child = f.db.forkConversation(parent.id, "subagent");
    new ThreadLogLegacyImporter(f.db, f.log, new EventProjector(f.db, f.log)).importConversationIfMissing(child.id);
    const first = await f.send(child.id, "child first");
    await f.send(parent.id, "parent-only request");
    const second = await f.send(child.id, "child follow-up");
    expect(first.cacheKey).toBe(`aster:${child.id}`);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.messages[0]).toEqual(first.messages[0]);
    expect(second.tools).toEqual(first.tools);
    expect(second.messages.some(message => message.content === "child first")).toBe(true);
    expect(second.messages.some(message => message.content === "parent-only request")).toBe(false);
    expect(second.tools.some(tool => tool.name === "send_agent_message")).toBe(false);
  } finally { await f.dispose(); }
});
