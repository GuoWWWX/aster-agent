import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { imageGenerationResultSchema, modelRuntimeStatusSchema } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { SkillRuntime } from "./skill-runtime.js";
import { SYSTEM_SKILLS } from "./prompts/prompt-assets.js";
import { AgentRuntime } from "./agent-runtime.js";
import { ImageGenerationTool } from "../tools/image-generation-tool.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfoAAAAASUVORK5CYII=";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const dispose of cleanup.splice(0)) await dispose(); });

it.each([
  ["full_access", true, true, "batch"], ["request_approval", false, true, "batch"], ["request_approval", true, true, "batch"], ["read_only", true, true, "batch"], ["full_access", true, false, "batch"],
  ["full_access", true, true, "single"], ["full_access", true, true, "partial"], ["full_access", true, true, "cancel"], ["full_access", true, true, "network"],
] as const)("generates through Skill, approval and managed attachments (%s approve=%s loaded=%s)", async (permissionMode, approved, loadSkill, responseMode) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-imagegen-"));
  const database = new AgentDatabase(":memory:");
  cleanup.push(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  const integrations = new IntegrationConfigurationStore(path.join(directory, "integrations.json"));
  const documents = new SkillDocumentStore(integrations, path.join(directory, "skills"));
  for (const source of SYSTEM_SKILLS) documents.ensureManagedDocument(source);
  const skills = new SkillRuntime(documents, integrations), skill = skills.getCatalog().find(entry => entry.name === "imagegen")!;
  const projects = new ProjectRegistry(database), attachments = new ConversationAttachmentStore(database, projects, directory);
  const providerId = "00000000-0000-4000-8000-000000000001";
  const configuration = { apiKey: "fixture", apiFormat: "openai-responses" as const, baseUrl: "https://fixture.invalid/v1", modelId: "fixture", reasoningOptions: [] };
  let requestCount = 0;
  const progressCounts: number[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
    requestCount++;
    if (requestCount === 2) expect(progressCounts).toContain(1);
    if (responseMode === "network" && requestCount === 2) return Promise.reject(new TypeError("fetch failed fixture-private-key"));
    return Promise.resolve(responseMode === "partial" && requestCount === 2
      ? Response.json({ error: { message: "Fixture failure" } }, { status: 503 })
      : Response.json({ data: responseMode === "batch" ? [{ b64_json: png }, { b64_json: png }] : [{ b64_json: png }] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const status = modelRuntimeStatusSchema.parse({ configured: true, modelId: "fixture", providerId, baseUrl: configuration.baseUrl, models: [{
    modelId: "gpt-image-2.5-flare", modelType: "image", displayName: "Image", contextWindow: 0, reasoningOptions: [],
    providerId, providerName: "Fixture", providerApiFormat: configuration.apiFormat, providerBaseUrl: configuration.baseUrl,
  }], supportsStreaming: true, supportsTools: true });
  let turns = 0;
  const runtime = new AgentRuntime(database, { getStatus: () => status, getConfiguration: (_provider, modelId) => ({ ...configuration, modelId: modelId ?? configuration.modelId }) }, projects, new ProjectToolRegistry(projects), {
    completeTurn: () => {
      turns++;
      const call = loadSkill && turns === 1 ? { id: "load", name: "load_skill", arguments: JSON.stringify({ skillId: skill.id }) }
        : turns === (loadSkill ? 2 : 1) ? { id: "generate", name: "generate_images", arguments: JSON.stringify({ prompt: "minimal icon", count: 2 }) } : null;
      return Promise.resolve({ content: call === null ? "已处理" : "", finishReason: call === null ? "stop" : "tool_calls", toolCalls: call === null ? [] : [call] });
    },
  }, undefined, undefined, null, attachments, null, skills);
  const conversation = database.createConversation(null);
  runtime.sendMessage({ conversationId: conversation.id, content: "生成两张图", permissionMode }, event => {
    if (event.type === "tool.started" && event.tool.name === "generate_images" && event.tool.result !== null) {
      const result = imageGenerationResultSchema.parse(JSON.parse(event.tool.result));
      progressCounts.push(result.value.count);
      if (responseMode === "cancel") runtime.cancelRun(event.runId);
      expect(attachments.readImagePreview(conversation.id, result.value.images[0]!.id).data).toBe(png);
    }
    if (event.type === "tool.approval_requested") {
      expect(fetcher).not.toHaveBeenCalled();
      runtime.approveToolChange({ approved, runId: event.runId, toolId: event.tool.id });
    }
  });
  await vi.waitFor(() => expect(database.getConversation(conversation.id).activeRunId).toBeNull());
  const expected = permissionMode !== "read_only" && approved && loadSkill;
  expect(fetcher).toHaveBeenCalledTimes(expected ? responseMode === "batch" || responseMode === "cancel" ? 1 : 2 : 0);
  expect(attachments.listDrafts(conversation.id)).toHaveLength(0);
  if (expected) {
    const tool = database.listTimeline(conversation.id).find(item => item.kind === "tool" && item.name === "generate_images");
    expect(tool).toMatchObject({ status: (responseMode === "partial" || responseMode === "network") ? "failed" : responseMode === "cancel" ? "cancelled" : "completed" });
    if (tool?.kind !== "tool") throw new Error("Missing generated output");
    const result = imageGenerationResultSchema.parse(JSON.parse(tool.result!));
    expect(result.value.images).toHaveLength(responseMode === "partial" || responseMode === "network" || responseMode === "cancel" ? 1 : 2);
    if (responseMode === "partial") expect(result.value.notice).toContain("HTTP 503");
    if (responseMode === "network") { expect(result.value.notice).toContain("未自动重试"); expect(tool.result).not.toContain("fixture-private-key"); }
    expect(progressCounts).toEqual(responseMode === "partial" || responseMode === "network" || responseMode === "cancel" ? [1] : [1, 2]);
    for (const image of result.value.images) {
      expect(image).toMatchObject({ source: "generated", conversationId: conversation.id, messageId: tool.id });
      expect(attachments.readImagePreview(conversation.id, image.id).data).toBe(png);
    }
    if (responseMode === "cancel") return;
    expect(result.value.displayRef).toMatch(/^artifact:[0-9a-f-]{36}$/u);
    const lastMessage = database.listTimeline(conversation.id).findLast(item => item.kind === "message");
    if (lastMessage === undefined) throw new Error("Missing fork boundary");
    const fork = database.forkConversation(conversation.id, "sibling", lastMessage.id);
    const forkTool = database.listTimeline(fork.id).find(item => item.kind === "tool" && item.name === "generate_images");
    if (forkTool?.kind !== "tool") throw new Error("Missing forked images");
    const forkValue = imageGenerationResultSchema.parse(JSON.parse(forkTool.result!)).value;
    expect(forkValue.displayRef).toBe(result.value.displayRef);
    const forkImages = forkValue.images;
    expect(forkImages).toHaveLength(responseMode === "partial" || responseMode === "network" ? 1 : 2);
    const forkedResult = database.listModelMessages(fork.id).filter(message => message.role === "tool")
      .map(message => imageGenerationResultSchema.safeParse(JSON.parse(message.content))).find(result => result.success);
    expect(forkedResult?.data?.value.images.map(image => image.id)).toEqual(forkImages.map(image => image.id));
    expect(forkedResult?.data?.value.displayRef).toBe(result.value.displayRef);
    for (const image of forkImages) {
      expect(image.conversationId).toBe(fork.id);
      expect(attachments.readImagePreview(fork.id, image.id).data).toBe(png);
    }
    const foreign = database.createConversation(null);
    const prepared = new ImageGenerationTool({ getStatus: () => status, getConfiguration: () => configuration }, attachments)
      .prepare(JSON.stringify({ prompt: "edit", referenceAttachmentIds: [result.value.images[0]!.id] }), foreign.id, providerId, new AbortController().signal, () => Promise.reject(new Error("Should not save a foreign attachment")));
    if (prepared.kind !== "approved_action") throw new Error("Missing approval boundary");
    await expect(prepared.action.execute()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(responseMode === "batch" ? 1 : 2);
  }
});
