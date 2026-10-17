import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { z } from "zod";
import { AgentDatabase } from "../storage/agent-database.js";
import { CollaborationTool } from "./collaboration-tool.js";

const opened: AgentDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const database of opened.splice(0)) database.close(); });

function fixture() {
  const database = new AgentDatabase(":memory:"); opened.push(database);
  database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const instance = database.createTeamInstance({ teamId: "default-team", scope: "global" });
  const lead = database.createConversation(null, { teamId: instance.teamId, threadKind: "team_lead" });
  database.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId,
    teamInstanceId: instance.id, projectId: null, sourceConversationId: null });
  database.setTeamInstanceRoot(instance.id, lead.id);
  return { database, instance, lead, tool: new CollaborationTool(database) };
}

it.each(["read_team_messages", "post_team_message"])("does not scan or synchronize the board for %s", async (name) => {
  const { database, lead, tool } = fixture();
  const list = vi.spyOn(database, "listTeamWorkItems");
  const sync = vi.spyOn(database.collaboration, "syncWorkItems");
  const result = await tool.execute({ name, arguments: JSON.stringify(name === "post_team_message" ? { content: "你好" } : {}),
    conversationId: lead.id, runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(),
    post: input => database.collaboration.postMessage(input, lead.id) });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  expect(list).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("still imports existing board tasks when listing the task directory", async () => {
  const { database, instance, lead, tool } = fixture();
  const modelSelection = { providerId: randomUUID(), modelId: "test-model", reasoning: null };
  const task = database.createTeamWorkItem({ teamId: instance.teamId, teamInstanceId: instance.id,
    projectId: null, title: "Existing task", requirement: "Keep board task identity", acceptanceCriteria: [],
    priority: "normal", permissionMode: "full_access", modelSelection }, modelSelection);
  const result = await tool.execute({ name: "list_task_contexts", arguments: "{}", conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  if (result.kind !== "completed") throw new Error("Expected a completed directory read.");
  const response = z.object({ value: z.object({ items: z.array(z.object({ id: z.string() })) }) }).parse(JSON.parse(result.content));
  expect(response.value.items).toContainEqual({ id: task.id });
});

it("searches already-read history on explicit filters and still validates the full date range", async () => {
  const { database, instance, lead, tool } = fixture();
  const message = database.collaboration.postMessage({ teamInstanceId: instance.id, content: "已读的 HTML 交付", intent: "notify", requestId: randomUUID() }, null);
  database.collaboration.markRead({ teamInstanceId: instance.id, throughSequence: message.sequence }, lead.id);
  const execute = (args: unknown) => tool.execute({ name: "read_team_messages", arguments: JSON.stringify(args), conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  const result = await execute({ query: "html" });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  if (result.kind !== "completed") throw new Error("Expected history results.");
  const response = z.object({ value: z.object({ messages: z.array(z.object({ id: z.string() })) }) }).parse(JSON.parse(result.content));
  expect(response.value.messages.map(item => item.id)).toEqual([message.id]);
  expect(await execute({ createdAfter: "2026-10-20T00:00:00.000Z", createdBefore: "2026-10-01T00:00:00.000Z" })).toMatchObject({ kind: "completed", isError: true });
});
