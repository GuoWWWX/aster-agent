import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { AgentRuntime } from "../agent/agent-runtime.js";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import type { ModelCredentialStore } from "../model/model-credential-store.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { TeamWorkItemRuntime } from "./team-work-item-runtime.js";

it("delivers a team task through persistent implementation, independent command verification and leader acceptance", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "team-delivery-integration-"));
  const database = new AgentDatabase(":memory:");
  const log = new ThreadLog(path.join(home, "conversations"));
  const projector = new EventProjector(database, log);
  const lifecycle = new ConversationLifecycleService(database, log, projector);
  const projects = new ProjectRegistry(database);
  const tools = new ProjectToolRegistry(projects);
  const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
  for (const [id, marker] of [["team-lead", "TEAM_LEAD_FIXTURE"], ["backend-engineer", "TEAM_DEV_FIXTURE"], ["qa-engineer", "TEAM_QA_FIXTURE"]]) {
    directory.agents.find(agent => agent.id === id)!.instructions = marker!;
  }
  database.syncTeamDirectory(directory);
  const project = await projects.registerDirectory(home);
  const selection = { providerId: crypto.randomUUID(), modelId: "team-model", reasoning: null };
  const credentials = { getPreferredSelection: () => selection, resolveSelection: () => selection,
    getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions" as const, baseUrl: "https://fixture.invalid/v1", modelId: selection.modelId, reasoningOptions: [] }) };
  let developerId = ""; let testerId = "";
  let leadTurn = 0; let developerTurn = 0; let testerTurn = 0;
  const requests: CompleteTurnInput[] = [];
  const call = (name: string, args: Record<string, unknown>) => ({ arguments: JSON.stringify(args), id: crypto.randomUUID(), name });
  const model: ModelProviderAdapter = { completeTurn(input): Promise<ModelTurnResult> {
    requests.push({ ...input, messages: [...input.messages] });
    const system = input.messages[0]?.content ?? "";
    let content = "";
    let toolCalls: ModelTurnResult["toolCalls"] = [];
    if (system.includes("TEAM_LEAD_FIXTURE")) {
      if (leadTurn++ < 2) {
        const recipient = leadTurn === 1 ? developerId : testerId;
        toolCalls = [call("send_agent_message", { conversationId: recipient, content: leadTurn === 1 ? "实现文件" : "独立运行测试", expectReply: true }),
          call("wait_for_agent_message", { conversationId: recipient, timeoutMs: 10_000 })];
      } else content = "开发已交付，独立测试已执行；等待用户验收。";
    } else if (system.includes("TEAM_DEV_FIXTURE")) {
      if (developerTurn++ === 0) toolCalls = [call("write_file", { path: "team-artifact.txt", content: "verified" })];
      else content = "文件已创建。\n\n---\n完整实现记录保留在成员对话。";
    } else if (system.includes("TEAM_QA_FIXTURE")) {
      if (testerTurn++ === 0) toolCalls = [call("run_command", { command: 'node -e "const fs=require(\'fs\');if(fs.readFileSync(\'team-artifact.txt\',\'utf8\')!==\'verified\')process.exit(1);console.log(\'CHECK_PASSED\');"', timeoutMs: 10_000 })];
      else content = "独立测试通过 CHECK_PASSED。\n\n---\n测试命令与退出码保留在本对话。";
    } else throw new Error("Unexpected model role");
    if (content.length > 0) input.onTextDelta(content);
    return Promise.resolve({ content, finishReason: toolCalls.length > 0 ? "tool_calls" : "stop", toolCalls });
  } };
  const runtime = new AgentRuntime(database, credentials, projects, tools, model, undefined, undefined, null, null,
    { getConfiguration: () => directory }, null, null, undefined, null, log, projector, null, null, null, null, null, { generateTurnSummaries: false }, lifecycle);
  const teams = new TeamWorkItemRuntime(database, lifecycle, runtime, credentials as unknown as ModelCredentialStore, projects, { getConfiguration: () => directory });
  runtime.setTeamWorkItemDispatcher(teams);
  try {
    const instance = teams.createInstance({ teamId: "default-team", projectId: project.id, scope: "project" });
    const members = database.listTeamMemberConversations(instance.rootConversationId!);
    developerId = members.find(member => member.agentId === "backend-engineer")!.id;
    testerId = members.find(member => member.agentId === "qa-engineer")!.id;
    const work = teams.submit({ teamId: instance.teamId, teamInstanceId: instance.id, projectId: project.id, title: "交付验证", requirement: "写入文件并独立执行测试",
      permissionMode: "full_access", acceptanceCriteria: ["文件已写入", "独立测试通过"], priority: "normal" }, () => undefined);
    await vi.waitFor(() => expect(database.getTeamWorkItem(work.id).status).toBe("waiting_user"), { timeout: 20_000, interval: 20 });
    const written = database.listTimeline(developerId).find(item => item.kind === "tool" && item.name === "write_file");
    expect(written, JSON.stringify(written)).toMatchObject({ status: "completed" });
    expect(await readFile(path.join(home, "team-artifact.txt"), "utf8")).toBe("verified");
    const task = database.getTeamWorkItem(work.id);
    expect(task.participantConversationIds).toEqual(expect.arrayContaining([developerId, testerId]));
    expect(database.getConversation(developerId).permissionMode).toBe("full_access");
    expect(database.getConversation(testerId).permissionMode).toBe("full_access");
    expect(database.listTimeline(testerId).some(item => item.kind === "tool" && item.name === "run_command" && item.status === "completed" && item.result?.includes("CHECK_PASSED"))).toBe(true);
    expect(database.listSubagentTasks(instance.rootConversationId!)).toEqual([]);
    const context = database.getTeamTaskContext(testerId, { limit: 10 });
    expect(context.tasks).toHaveLength(1);
    expect(context.tasks[0]?.participants.map(member => member.conversationId)).toEqual(expect.arrayContaining([developerId, testerId]));
    expect(requests.filter(request => request.messages[0]?.content.includes("TEAM_LEAD_FIXTURE"))).toHaveLength(3);
    expect(teams.accept({ workItemId: work.id, acceptedCriteria: ["文件已写入", "独立测试通过"] }).status).toBe("completed");
  } finally {
    tools.dispose(); database.close(); await rm(home, { recursive: true, force: true });
  }
}, 30_000);
