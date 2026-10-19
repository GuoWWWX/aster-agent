import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_APPLICATION_SETTINGS, type ApplicationSettings } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { WebSearchTool } from "../tools/web-search-tool.js";
import { AgentRuntime } from "./agent-runtime.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it.each([
  ["request_approval", "allow", true, 0, false, "write_file"],
  ["auto_review", "allow", false, 1, true, "write_file"],
  ["auto_review", "high", true, 1, false, "write_file"],
  ["auto_review", "invalid", true, 1, false, "write_file"],
  ["auto_review", "failure", true, 1, false, "write_file"],
  ["full_access", "allow", false, 0, true, "write_file"],
  ["request_approval", "allow", true, 0, false, "web_search"],
  ["auto_review", "allow", false, 1, true, "web_search"],
  ["auto_review", "invalid", true, 1, false, "web_search"],
  ["full_access", "allow", false, 0, true, "web_search"],
  ["request_approval", "allow", true, 0, false, "read_external_file"],
  ["full_access", "allow", false, 0, true, "read_external_file"],
] as const)("applies %s locally with %s review (%s)", async (mode, review, asks, reviews, writes, toolName) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-permission-modes-"));
  const database = new AgentDatabase(":memory:");
  cleanups.push(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  const projectPath = path.join(root, "project"); await mkdir(projectPath);
  const externalPath = path.join(root, "outside.txt"); await writeFile(externalPath, "outside content");
  const projects = new ProjectRegistry(database), project = await projects.registerDirectory(projectPath);
  const conversation = database.createConversation(project.id);
  database.setConversationPermissionMode(conversation.id, mode);
  expect(database.getConversation(conversation.id).permissionMode).toBe(mode);
  let turns = 0, reviewCalls = 0, networkCalls = 0, asked = false;
  const settings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  settings.general.approvalReviewer = mode === "request_approval" ? "auto_review" : "user";
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid", modelId: "fixture", reasoningOptions: [] }) }, projects, new ProjectToolRegistry(projects), {
    completeTurn: input => {
      if (input.tools.length === 0) {
        reviewCalls++;
        if (review === "failure") throw new Error("Review unavailable");
        return Promise.resolve({ content: review === "invalid" ? "invalid" : JSON.stringify({ decision: "allow", risk: review === "high" ? "high" : "low", reason: "Test review" }), finishReason: "stop", toolCalls: [] });
      }
      return Promise.resolve(++turns === 1 ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: "write", name: toolName, arguments: JSON.stringify(toolName === "web_search" ? { query: "公开信息" } : toolName === "read_external_file" ? { path: externalPath } : { path: "result.txt", content: "verified" }) }] }
        : { content: "本轮结束", finishReason: "stop", toolCalls: [] });
    },
  }, undefined, undefined, null, null, null, null, null, new WebSearchTool(() => { networkCalls++; return Promise.resolve([]); }), {
    getConfiguration: () => settings,
    saveConfiguration: (configuration: ApplicationSettings) => Object.assign(settings, configuration),
  });
  runtime.sendMessage({ conversationId: conversation.id, content: "写入 result.txt" }, event => {
    if (event.type === "tool.approval_requested") {
      asked = true;
      runtime.approveToolChange({ runId: event.runId, toolId: event.tool.id, approved: false });
    }
  });
  await vi.waitFor(() => expect(database.getConversation(conversation.id).activeRunId).toBeNull());
  expect(asked).toBe(asks); expect(reviewCalls).toBe(reviews);
  if (toolName === "web_search") expect(networkCalls).toBe(writes ? 1 : 0);
  else if (toolName === "read_external_file") {
    const tool = database.listTimeline(conversation.id).find(item => item.kind === "tool" && item.name === toolName);
    expect(tool).toMatchObject({ status: writes ? "completed" : "rejected" });
  } else if (writes) expect(await readFile(path.join(projectPath, "result.txt"), "utf8")).toBe("verified");
  else await expect(readFile(path.join(projectPath, "result.txt"))).rejects.toThrow();
});
