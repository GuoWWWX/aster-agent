import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveMessageCodeBlock } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { HtmlPreviewServer } from "./html-preview-server.js";

it.each(["restart", "eviction"] as const)("restores referenced React preview and original source after history %s", async mode => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "preview-history-"));
  const database = new AgentDatabase(":memory:");
  const log = new ThreadLog(directory);
  const creation = database.prepareConversationCreation(null);
  const conversationId = creation.conversation.id;
  const messageId = randomUUID();
  const runId = randomUUID();
  const code = 'export default function Ride() { return <button>暂停骑行</button>; }\n';
  log.append(conversationId, { type: "conversation_created", payload: creation });
  log.append(conversationId, { type: "run_created", payload: { runId, modelId: "demo" } });
  log.append(conversationId, { type: "assistant_message", payload: {
    messageId, runId, modelId: "demo", content: `\`\`\`jsx\n${code}\`\`\``,
  } });
  log.append(conversationId, { type: "run_finished", payload: { runId, status: "completed" } });
  const projector = new EventProjector(database, log);
  const server = new HtmlPreviewServer(() => Promise.reject(new Error("No workspace needed")), (owner, reference) =>
    resolveMessageCodeBlock(projector.listTimeline(owner).filter(item => item.kind === "message"), reference));
  try {
    projector.projectAllConversationLogs({ releaseHistory: true });
    if (mode === "eviction") {
      projector.ensureConversationHistoryProjected(conversationId);
      expect(database.listTimeline(conversationId)).toHaveLength(1);
      for (let i = 0; i < 8; i++) {
        const other = database.prepareConversationCreation(null);
        log.append(other.conversation.id, { type: "conversation_created", payload: other });
        database.projectConversationCreated(other);
        projector.ensureConversationHistoryProjected(other.conversation.id);
      }
    }
    expect(database.listTimeline(conversationId)).toEqual([]);
    const sourceRef = `codeblock:${messageId}:1`;
    const preview = await server.create({ kind: "reference", conversationId, sourceRef });
    expect(preview.source).toBe(code);
    expect(await (await fetch(preview.url)).text()).toContain("暂停骑行");
    expect(database.listTimeline(conversationId)).toEqual([]);
    const other = database.createConversation(null);
    await expect(server.create({ kind: "reference", conversationId: other.id, sourceRef })).rejects.toThrow("找不到");
    await expect(server.create({ kind: "reference", conversationId, sourceRef: `codeblock:${randomUUID()}:1` })).rejects.toThrow("找不到");
  } finally {
    server.dispose();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
