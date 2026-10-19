import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationPermissionMode } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { AgentRuntime } from "./agent-runtime.js";
import { SkillRuntime } from "./skill-runtime.js";
import { SYSTEM_SKILLS } from "./prompts/prompt-assets.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });

it.each([
  ["full_access", true], ["read_only", false], ["ask_before_changes", true], ["ask_before_changes", false],
] as const)("creates a discoverable skill through normal Runtime permissions (%s, approve=%s)", async (permissionMode: ConversationPermissionMode, approved) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-create-skill-"));
  const database = new AgentDatabase(":memory:");
  cleanup.push(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  const integrations = new IntegrationConfigurationStore(path.join(directory, "integrations.json"));
  const documents = new SkillDocumentStore(integrations, path.join(directory, "skills"));
  for (const source of SYSTEM_SKILLS) documents.ensureManagedDocument(source);
  const skills = new SkillRuntime(documents, integrations);
  expect(skills.getCatalog().some(skill => skill.name === "skill-creator")).toBe(true);
  const skillId = skills.getCatalog().find(skill => skill.name === "skill-creator")!.id;
  const projects = new ProjectRegistry(database);
  const content = "---\nname: review-numbers\ndescription: Verify arithmetic examples.\n---\n\nCheck the calculation with an independent decomposition.\n";
  let turns = 0;
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid", modelId: "fixture", reasoningOptions: [] }) }, projects, new ProjectToolRegistry(projects), {
    completeTurn: () => Promise.resolve(++turns === 1 ? { content: "", finishReason: "tool_calls", toolCalls: [
      { id: "load-creator", name: "load_skill", arguments: JSON.stringify({ skillId }) },
    ] } : turns === 2 ? { content: "", finishReason: "tool_calls", toolCalls: [
      { id: "create-personal-skill", name: "create_skill", arguments: JSON.stringify({ content }) },
    ] } : { content: "已处理本轮创建请求。", finishReason: "stop", toolCalls: [] }),
  }, undefined, undefined, null, null, null, skills);
  const conversation = database.createConversation(null);
  runtime.sendMessage({ conversationId: conversation.id, content: "创建一个算术验算技能", permissionMode }, () => {});
  if (permissionMode === "ask_before_changes") {
    await vi.waitFor(() => expect(database.listTimeline(conversation.id).some(item => item.kind === "tool" && item.status === "awaiting_approval")).toBe(true));
    expect(skills.getCatalog().some(skill => skill.name === "review-numbers")).toBe(false);
    const tool = database.listTimeline(conversation.id).find(item => item.kind === "tool" && item.status === "awaiting_approval")!;
    runtime.approveToolChange({ approved, runId: tool.runId!, toolId: tool.id });
  }
  await vi.waitFor(() => expect(database.getConversation(conversation.id).activeRunId).toBeNull());
  const expected = permissionMode !== "read_only" && approved;
  expect(skills.getCatalog().some(skill => skill.name === "review-numbers")).toBe(expected);
  expect(documents.discoverDocuments().documents.some(document => document.metadata.name === "review-numbers")).toBe(expected);
  const tool = database.listTimeline(conversation.id).find(item => item.kind === "tool" && item.name === "create_skill");
  expect(tool).toMatchObject({ status: expected ? "completed" : permissionMode === "read_only" ? "failed" : "rejected" });
});
