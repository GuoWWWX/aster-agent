import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildConversationReferenceBundle } from "./conversation-reference.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { ThreadLogReferenceReader } from "../storage/thread-log-reference-reader.js";

describe("ThreadLogReferenceReader", () => {
  it("reads and searches canonical history after volatile histories are released", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "reference-jsonl-"));
    const source = new AgentDatabase(":memory:");
    const restored = new AgentDatabase(":memory:");
    try {
      const conversation = source.createConversation(null);
      const run = source.createRunWithUserMessage(conversation.id, "ORION-7443 配置在哪", "demo");
      source.appendAssistantTurn({
        content: "配置在 config/orion.json", conversationId: conversation.id,
        messageId: crypto.randomUUID(), modelId: "demo", runId: run.runId, toolCalls: [],
      });
      source.finishRun(run.runId, "completed", null);
      const log = new ThreadLog(directory);
      new ThreadLogLegacyImporter(source, log, new EventProjector(source, log)).importMissingConversationLogs();
      new EventProjector(restored, log).projectAllConversationLogs({ releaseHistory: true });
      expect(restored.listContextMessages(conversation.id)).toEqual([]);
      const sqlPage = vi.spyOn(restored, "listContextMessagesPage");
      const sqlSearch = vi.spyOn(restored, "searchContextMessages");
      const history = new ThreadLogReferenceReader(restored, log);
      const bundle = buildConversationReferenceBundle({
        budgetTokens: 1_000, currentConversationId: crypto.randomUUID(), database: history,
        query: "ORION-7443", referencedConversationIds: [conversation.id],
      });
      expect(bundle.content).toContain("ORION-7443 配置在哪");
      expect(bundle.content).toContain("config/orion.json");
      const latest = history.listContextMessagesPage({ conversationId: conversation.id, limit: 1 });
      expect(latest[0]?.role).toBe("assistant");
      expect(history.listContextMessagesPage({
        conversationId: conversation.id, limit: 1, beforeSequence: latest[0]!.sequence,
      })[0]?.role).toBe("user");
      expect(sqlPage).not.toHaveBeenCalled();
      expect(sqlSearch).not.toHaveBeenCalled();
      vi.spyOn(log, "readContext").mockImplementation(() => { throw new Error("Run-scoped reads must not materialize the full history"); });
      expect(history.listContextMessagesForRun(run.runId, conversation.id).map((message) => message.content))
        .toEqual(["ORION-7443 配置在哪", "配置在 config/orion.json"]);
    } finally {
      source.close();
      restored.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
