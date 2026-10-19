import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
import { conversationAttachmentSchema } from "@agent/protocol";
import { z } from "zod";
import { AgentRuntime } from "../agent/agent-runtime.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import type { CompleteTurnInput, ModelProviderAdapter } from "../model/model-contracts.js";
import { ComputerUseTool } from "./computer-use-tool.js";
import type { ComputerControlPort } from "./windows-computer-controller.js";

describe("computer use through the existing Runtime", () => {
  it.each(["ask_before_changes", "read_only"] as const)("preserves %s approval and screenshot ownership", async (permissionMode) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-runtime-"));
    const database = new AgentDatabase(":memory:"); const projects = new ProjectRegistry(database); const tools = new ProjectToolRegistry(projects);
    const conversation = database.createConversation(null); const attachments = new ConversationAttachmentStore(database, projects, directory);
    const execute = vi.fn<ComputerControlPort["execute"]>().mockImplementation((command) => Promise.resolve({ ok: true, value: command.action === "screenshot"
      ? { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=", width: 1, height: 1 }
      : { performed: true } }));
    const computer = new ComputerUseTool({ execute, getStatus: () => ({ supported: true, running: true, elevated: false }), start: vi.fn(), stop: vi.fn() },
      { getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true }) });
    const requests: CompleteTurnInput[] = [];
    const model: ModelProviderAdapter = { completeTurn: (input) => {
      requests.push(input); expect(input.tools.some((tool) => tool.name === "computer_use")).toBe(true);
      const step = requests.length;
      return Promise.resolve(step < 3 ? { content: "", finishReason: "tool_calls", toolCalls: [{ id: `computer-${step}`, name: "computer_use",
        arguments: JSON.stringify(step === 1 ? { action: "screenshot", windowId: "123" } : { action: "click", windowId: "123", x: 0, y: 0 }) }] }
        : { content: "检查已完成", finishReason: "stop", toolCalls: [] });
    } };
    const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", modelId: "fixture", reasoningOptions: [] }) }, projects, tools, model,
      undefined, undefined, null, attachments, null, null, null, undefined, null, null, null, null, null, null, null, null, {}, null, computer);
    const events: ConversationRunEvent[] = [];
    try {
      await new Promise<void>((resolve) => runtime.sendMessage({ conversationId: conversation.id, content: "查看授权窗口并点击", permissionMode }, (event) => {
        events.push(event);
        if (event.type === "tool.approval_requested") {
          expect(execute).toHaveBeenCalledOnce();
          runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      }));
      expect(events.at(-1)).toMatchObject({ type: "run.finished", status: "completed" });
      expect(execute).toHaveBeenCalledTimes(permissionMode === "read_only" ? 1 : 2);
      const timeline = database.listTimeline(conversation.id);
      const screenshot = timeline.find((item) => item.kind === "tool" && item.arguments.includes("screenshot"));
      if (screenshot?.kind !== "tool" || screenshot.result === null) throw new Error("Missing saved screenshot");
      expect(screenshot.result).toContain('"source":"computer"');
      const final = timeline.findLast((item) => item.kind === "message" && item.role === "assistant");
      if (!final) throw new Error("Missing final answer");
      const fork = database.forkConversation(conversation.id, "sibling", final.id);
      const forkTool = database.listTimeline(fork.id).find((item) => item.kind === "tool" && item.arguments.includes("screenshot"));
      if (forkTool?.kind !== "tool" || forkTool.result === null) throw new Error("Missing forked screenshot");
      const image = z.object({ value: z.object({ image: conversationAttachmentSchema }) }).parse(JSON.parse(forkTool.result)).value.image;
      expect(image.conversationId).toBe(fork.id);
      expect(attachments.readImagePreview(fork.id, image.id).mimeType).toBe("image/png");
      expect(attachments.resolveThreadLogPaths(image).storedPath).toBe(database.getConversationAttachment(fork.id, image.id).storedPath);
      expect(JSON.stringify(requests[1]?.messages)).toContain("physical pixels relative to that window");
    } finally { await tools.dispose(); database.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
