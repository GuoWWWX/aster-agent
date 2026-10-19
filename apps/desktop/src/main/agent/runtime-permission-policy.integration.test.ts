import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { DEFAULT_APPLICATION_SETTINGS } from "@agent/protocol";
import type { ModelProviderAdapter } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";

it("reads the current application policy for each tool without caching it in the Run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-live-tool-permission-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(root);
  const conversation = database.createConversation(project.id);
  await writeFile(path.join(root, "evidence.txt"), "current evidence", "utf8");
  const settings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  let turn = 0;
  const model: ModelProviderAdapter = { completeTurn: () => {
    turn += 1;
    if (turn <= 2) {
      settings.permissionPolicies["workspace-read"] = turn === 1 ? "unavailable" : "allow";
      return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{
        id: `read-${turn}`, name: "read_file", arguments: JSON.stringify({ path: "evidence.txt" }),
      }] });
    }
    return Promise.resolve({ content: "Policy verified", finishReason: "stop", toolCalls: [] });
  } };
  const tools = new ProjectToolRegistry(projects);
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiFormat: "openai-chat-completions", apiKey: "test-key", baseUrl: "https://example.test/v1", modelId: "test-model", reasoningOptions: [],
  }) }, projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, {
    getConfiguration: () => settings,
    saveConfiguration: configuration => Object.assign(settings, configuration),
  });
  const execute = vi.spyOn(tools, "execute");
  try {
    runtime.sendMessage({ conversationId: conversation.id, content: "Verify current policy", permissionMode: "full_access" }, () => undefined);
    await vi.waitFor(() => expect(database.getConversation(conversation.id).activeRunId).toBeNull());
    const reads = database.listTimeline(conversation.id)
      .filter(item => item.kind === "tool")
      .filter(item => item.name === "read_file");
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatchObject({
      status: "failed", result: JSON.stringify({ error: "工作区读取已在应用权限设置中禁用。", ok: false }),
    });
    expect(reads[1]?.status).toBe("completed");
    expect(reads[1]?.result).toContain("current evidence");
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await runtime.stopAllRuns();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
