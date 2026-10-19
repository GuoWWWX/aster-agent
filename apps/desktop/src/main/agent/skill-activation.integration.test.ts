import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
import { ComputerUseTool } from "../computer-use/computer-use-tool.js";
import type { ComputerControlPort } from "../computer-use/windows-computer-controller.js";
import type { ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";
import { SYSTEM_SKILLS } from "./prompts/prompt-assets.js";
import { SkillRuntime } from "./skill-runtime.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
const final: ModelTurnResult = { content: "已完成", finishReason: "stop", toolCalls: [] };
function calls(...toolCalls: ModelTurnResult["toolCalls"]): ModelTurnResult {
  return { content: "", finishReason: "tool_calls", toolCalls };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aster-skill-lifecycle-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const tools = new ProjectToolRegistry(projects);
  disposals.push(async () => { await tools.dispose(); database.close(); await rm(root, { recursive: true, force: true }); });
  const integrations = new IntegrationConfigurationStore(path.join(root, "integrations.json"));
  const documents = new SkillDocumentStore(integrations, path.join(root, "skills"));
  for (const source of SYSTEM_SKILLS) documents.ensureManagedDocument(source);
  const review = documents.createManagedDocument({ content: "---\nname: review-fixture\ndescription: Review fixture.\n---\nUse CORE_SKILL_EVIDENCE for this task.\n" });
  await mkdir(path.join(path.dirname(review.entryPath), "references"));
  await writeFile(path.join(path.dirname(review.entryPath), "references", "check.md"), "REFERENCE_EVIDENCE_ONLY_ON_DEMAND");
  const skills = new SkillRuntime(documents, integrations);
  const reviewId = skills.getCatalog().find(entry => entry.name === "review-fixture")!.id;
  const conversation = database.createConversation(null);
  const createRuntime = (model: ModelProviderAdapter, log: ThreadLog | null = null, computer: ComputerUseTool | null = null) => new AgentRuntime(
    database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid", modelId: "fixture", reasoningOptions: [] }) },
    projects, tools, model, undefined, undefined, null, null, null, skills, null, undefined, null, log,
    null, null, null, null, null, null, {}, null, computer,
  );
  return { root, database, conversation, reviewId, skills, integrations, createRuntime };
}

async function send(runtime: AgentRuntime, conversationId: string, content: string) {
  const events: ConversationRunEvent[] = [];
  await new Promise<void>(resolve => runtime.sendMessage({ conversationId, content, permissionMode: "full_access" }, event => {
    events.push(event);
    if (event.type === "run.finished") resolve();
  }));
  expect(events.at(-1)).toMatchObject({ type: "run.finished", status: "completed" });
}

it.each([false, true])("reuses activation and lazy references across turns (JSONL=%s)", async useLog => {
  const f = await fixture();
  const log = useLog ? new ThreadLog(path.join(f.root, "threads")) : null;
  let turn = 0;
  const runtime = f.createRuntime({ completeTurn: input => {
    const text = JSON.stringify(input.messages);
    turn++;
    if (turn === 1) {
      expect(text).not.toContain("CORE_SKILL_EVIDENCE");
      return Promise.resolve(calls({ id: "activate", name: "load_skill", arguments: JSON.stringify({ skillId: f.reviewId }) }));
    }
    expect(text).toContain("CORE_SKILL_EVIDENCE");
    if (turn === 2) {
      expect(text).not.toContain("REFERENCE_EVIDENCE_ONLY_ON_DEMAND");
      return Promise.resolve(calls({ id: "reference", name: "read_skill_reference", arguments: JSON.stringify({ skillId: f.reviewId, path: "references/check.md" }) }));
    }
    expect(text).toContain("REFERENCE_EVIDENCE_ONLY_ON_DEMAND");
    return Promise.resolve(final);
  } }, log);
  await send(runtime, f.conversation.id, "使用审查技能");
  await send(runtime, f.conversation.id, "继续同一项审查");
  expect(turn).toBe(4);
  expect(f.database.listTimeline(f.conversation.id).filter(item => item.kind === "tool" && item.name === "load_skill")).toHaveLength(1);
  if (log === null) return;
  log.append(f.conversation.id, { type: "context_checkpoint", payload: { summary: "审查进行中", coveredThroughContextSequence: log.readContext(f.conversation.id)!.messages.length } });
  let restoredTurns = 0;
  const restarted = f.createRuntime({ completeTurn: input => {
    const text = JSON.stringify(input.messages);
    expect(text).toContain("CORE_SKILL_EVIDENCE");
    restoredTurns++;
    if (restoredTurns === 1) {
      expect(text).not.toContain("REFERENCE_EVIDENCE_ONLY_ON_DEMAND");
      return Promise.resolve(calls({ id: "reference-after-compaction", name: "read_skill_reference", arguments: JSON.stringify({ skillId: f.reviewId, path: "references/check.md" }) }));
    }
    expect(text).toContain("REFERENCE_EVIDENCE_ONLY_ON_DEMAND");
    return Promise.resolve(final);
  } }, new ThreadLog(path.join(f.root, "threads")));
  await send(restarted, f.conversation.id, "压缩后继续审查");
  expect(restoredTurns).toBe(2);
  expect(f.database.listTimeline(f.conversation.id).filter(item => item.kind === "tool" && item.name === "load_skill")).toHaveLength(1);
});

it("keeps activation conversation-local and revalidates revocation before a new turn", async () => {
  const f = await fixture();
  let turn = 0;
  const runtime = f.createRuntime({ completeTurn: input => {
    turn++;
    if (turn === 1) return Promise.resolve(calls({ id: "activate", name: "load_skill", arguments: JSON.stringify({ skillId: f.reviewId }) }));
    expect(JSON.stringify(input.messages).includes("CORE_SKILL_EVIDENCE")).toBe(turn === 2);
    return Promise.resolve(final);
  } });
  await send(runtime, f.conversation.id, "加载技能");
  await send(runtime, f.database.createConversation(null).id, "另一个对话");
  const config = f.integrations.getConfiguration();
  f.integrations.saveConfiguration({ ...config, skills: config.skills.map(skill => skill.id === f.reviewId ? { ...skill, enabled: false } : skill) });
  await send(runtime, f.conversation.id, "停用技能之后继续");
});

it("blocks desktop actions in the load batch, then permits them after the model sees the Skill", async () => {
  const f = await fixture();
  const execute = vi.fn<ComputerControlPort["execute"]>().mockResolvedValue({ ok: true, value: { performed: true } });
  const computer = new ComputerUseTool({ execute, getStatus: () => ({ supported: true, running: true, elevated: false }), start: vi.fn(), stop: vi.fn() },
    { getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true }) });
  const skillId = f.skills.getCatalog().find(entry => entry.name === "computer-use")!.id;
  let turn = 0;
  const runtime = f.createRuntime({ completeTurn: input => {
    turn++;
    if (turn === 1) return Promise.resolve(calls(
      { id: "activate-computer", name: "load_skill", arguments: JSON.stringify({ skillId }) },
      { id: "premature-start", name: "computer_use", arguments: '{"action":"start"}' },
    ));
    if (turn === 2) {
      expect(execute).not.toHaveBeenCalled();
      expect(input.messages.some(message => message.role === "user" && message.content.includes("# Computer Use"))).toBe(true);
      expect(input.messages.some(message => message.role === "tool" && message.content.includes("下一次模型请求"))).toBe(true);
      return Promise.resolve(calls({ id: "start-after-reading", name: "computer_use", arguments: '{"action":"start"}' }));
    }
    expect(execute).toHaveBeenCalledOnce();
    return Promise.resolve(final);
  } }, null, computer);
  await send(runtime, f.conversation.id, "开始桌面操作");
  expect(f.database.listTimeline(f.conversation.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "tool", name: "computer_use", status: "failed" }),
    expect.objectContaining({ kind: "tool", name: "computer_use", status: "completed" }),
  ]));
});

it("rechecks Skill revocation after an operation approval is resumed", async () => {
  const f = await fixture();
  const execute = vi.fn<ComputerControlPort["execute"]>().mockResolvedValue({ ok: true, value: { performed: true } });
  const computer = new ComputerUseTool({ execute, getStatus: () => ({ supported: true, running: true, elevated: false }), start: vi.fn(), stop: vi.fn() },
    { getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true }) });
  const skillId = f.skills.getCatalog().find(entry => entry.name === "computer-use")!.id;
  let turn = 0;
  const runtime = f.createRuntime({ completeTurn: () => {
    turn++;
    return Promise.resolve(turn === 1 ? calls({ id: "activate", name: "load_skill", arguments: JSON.stringify({ skillId }) })
      : turn === 2 ? calls({ id: "start", name: "computer_use", arguments: '{"action":"start"}' }) : final);
  } }, null, computer);
  let approvalCount = 0;
  await new Promise<void>(resolve => runtime.sendMessage({ conversationId: f.conversation.id, content: "开始控制", permissionMode: "request_approval" }, event => {
    if (event.type === "tool.approval_requested") {
      approvalCount++;
      const config = f.integrations.getConfiguration();
      f.integrations.saveConfiguration({ ...config, skills: config.skills.map(skill => skill.id === skillId ? { ...skill, enabled: false } : skill) });
      runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
    }
    if (event.type === "run.finished") resolve();
  }));
  expect(approvalCount).toBe(1);
  expect(execute).not.toHaveBeenCalled();
  const operation = f.database.listTimeline(f.conversation.id).find(item => item.kind === "tool" && item.name === "computer_use");
  expect(operation?.status).toBe("failed");
  expect(operation?.kind === "tool" ? operation.result : null).toContain("未启用");
});
