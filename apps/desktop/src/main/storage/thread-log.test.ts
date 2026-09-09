import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadLog } from "./thread-log.js";

const temporaryDirectories: string[] = [];
const conversationId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createThreadLog(): Promise<ThreadLog> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-thread-log-"));
  temporaryDirectories.push(directory);
  return new ThreadLog(directory);
}

describe("ThreadLog", () => {
  it("restores first-token timing even when the provider omitted usage", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-first-token-"));
    temporaryDirectories.push(directory);
    const log = new ThreadLog(directory);
    log.append(conversationId, { type: "assistant_message", payload: {
      content: "answer", runId: "run", providerState: {
        apiFormat: "openai-chat-completions", baseUrl: "https://example.test", modelId: "test",
        payload: {}, firstTokenLatencyMs: 250,
      },
    } });
    expect(new ThreadLog(directory).readProviderUsageStates(conversationId)?.[0])
      .toMatchObject({ firstTokenLatencyMs: 250, payload: null });
  });
  it("loads only uncovered bodies and keeps usage independent of full context", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { type: "user_message", payload: { content: "old".repeat(500_000), runId: "old" } });
    log.append(conversationId, { type: "assistant_message", payload: { content: "old answer", runId: "old",
      providerState: { apiFormat: "openai_chat_completions", baseUrl: "https://example.com", modelId: "test", payload: { secret: "opaque" },
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 80 } } } });
    log.append(conversationId, { type: "context_checkpoint", payload: { summary: "summary", coveredThroughContextSequence: 2 } });
    log.append(conversationId, { type: "user_message", payload: { content: "recent", runId: "new" } });
    const read = vi.spyOn(log, "readRecord");
    vi.spyOn(log, "readContext").mockImplementation(() => { throw new Error("full context must not be read"); });
    expect(log.readUncoveredContext(conversationId)?.messages.map((message) => [message.sequence, message.content])).toEqual([[3, "recent"]]);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockClear();
    expect(log.readProviderUsageStates(conversationId)?.[0]).toMatchObject({ payload: null, usage: { cachedInputTokens: 80 } });
    expect(read).not.toHaveBeenCalled();
    log.append(conversationId, { type: "run_superseded", payload: { runId: "old" } });
    expect(log.readUncoveredContext(conversationId)).toMatchObject({ checkpoint: null, messages: [{ sequence: 1, content: "recent" }] });
    expect(log.readProviderUsageStates(conversationId)).toEqual([]);
  });

  it("invalidates indexed context after external edits and keeps legacy positions", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { type: "legacy_snapshot_imported", payload: { modelMessages: [
      { role: "user", sequence: 10, content: "legacy question", runId: "legacy" },
      { role: "assistant", sequence: 20, content: "legacy answer", runId: "legacy" },
    ], checkpoint: { coveredThroughSequence: 10, summary: "summary" } } });
    expect(log.readUncoveredContext(conversationId)?.messages.map((message) => message.content)).toEqual(["legacy answer"]);
    const source = await readFile(log.getPath(conversationId), "utf8");
    await writeFile(log.getPath(conversationId), source.replace("legacy answer", "externally changed answer"));
    expect(log.readUncoveredContext(conversationId)?.messages[0]?.content).toBe("externally changed answer");
    log.append(conversationId, { type: "run_replaced", payload: { previousRunId: "legacy", runId: "new", content: "replacement" } });
    expect(log.readUncoveredContext(conversationId)).toMatchObject({ checkpoint: null, messages: [{ sequence: 1, content: "replacement" }] });
  });

  it("searches Chinese covered messages without re-reading a legacy snapshot per message", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { type: "legacy_snapshot_imported", payload: {
      modelMessages: Array.from({ length: 100 }, (_, index) => ({
        role: "user", sequence: index + 1, content: `登录问题 ${index}`, runId: null,
      })), checkpoint: { coveredThroughSequence: 100, summary: "summary" },
    } });
    const read = vi.spyOn(log, "readRecord");
    const matches = log.searchCoveredContext(conversationId, "之前登录怎么修复的");
    expect(matches).toHaveLength(24);
    expect(matches[0]?.content).toContain("登录");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("finds a complete state checkpoint across UTF-8 chunks and scans its tail", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { type: "user_message", payload: { content: "旧历史" } });
    const checkpoint = log.append(conversationId, { type: "state_checkpoint", payload: { marker: "中文".repeat(90_000) } });
    const tail = log.append(conversationId, { type: "assistant_message", payload: { content: "后续" } });
    const located = log.readLatestStateCheckpoint(conversationId)!;
    expect(located.event).toEqual(checkpoint);
    const events: unknown[] = [];
    log.scan(conversationId, (event) => events.push(event), located.cursor);
    expect(events).toEqual([tail]);
    await appendFile(log.getPath(conversationId), '{"type":"state_checkpoint"', "utf8");
    expect(log.readLatestStateCheckpoint(conversationId)?.event).toEqual(checkpoint);
  });

  it("evicts retained contexts by byte budget without truncating canonical history", async () => {
    const log = await createThreadLog();
    const otherId = "00000000-0000-4000-8000-000000000002";
    log.append(conversationId, { type: "user_message", payload: { content: "x".repeat(5 * 1_024 * 1_024) } });
    const first = log.readContext(conversationId);
    log.append(otherId, { type: "user_message", payload: { content: "y".repeat(5 * 1_024 * 1_024) } });
    log.readContext(otherId);
    const rebuilt = log.readContext(conversationId);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt?.messages[0]?.content.length).toBe(5 * 1_024 * 1_024);
    log.append(conversationId, { type: "assistant_message", payload: { content: "z".repeat(4 * 1_024 * 1_024) } });
    expect(log.readContext(conversationId)).not.toBe(rebuilt);
    expect(log.readContext(conversationId)?.messages).toHaveLength(2);
  });

  it("scans UTF-8 record offsets and reads only the selected record", async () => {
    const log = await createThreadLog();
    const first = log.append(conversationId, {
      payload: { content: "中文🙂".repeat(70_000) }, type: "user_message",
    });
    const second = log.append(conversationId, {
      payload: { content: "最后一条" }, type: "assistant_message",
    });
    const locations: { offset: number; length: number }[] = [];
    log.scan(conversationId, (_event, location) => locations.push(location));
    expect(locations).toHaveLength(2);
    expect(log.readRecord(conversationId, locations[1]!)).toEqual(second);
    expect(log.readRecord(conversationId, locations[0]!)).toEqual(first);
    expect(locations[1]!.offset).toBe(locations[0]!.offset + locations[0]!.length + 1);
    expect(() => log.readRecord(conversationId, { offset: -1, length: 10 })).toThrow();
  });

  it("creates a versioned header and appends strictly ordered events", async () => {
    const log = await createThreadLog();

    const first = log.append(conversationId, {
      payload: { content: "first", runId: "run-1" },
      type: "user_message",
    });
    const second = log.append(conversationId, {
      payload: { runId: "run-1", status: "completed" },
      type: "run_finished",
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(log.read(conversationId)).toMatchObject({
      events: [
        { payload: { content: "first", runId: "run-1" }, sequence: 1, type: "user_message" },
        { payload: { runId: "run-1", status: "completed" }, sequence: 2, type: "run_finished" },
      ],
      header: { conversationId, type: "thread_header", version: 1 },
    });
  });

  it("drops only a malformed final line and preserves the last complete event", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { payload: { content: "kept" }, type: "user_message" });
    await appendFile(log.getPath(conversationId), '{"type":"assistant_message"', "utf8");

    const recovered = log.read(conversationId);

    expect(recovered?.events).toHaveLength(1);
    await expect(readFile(log.getPath(conversationId), "utf8")).resolves.not.toContain(
      "assistant_message",
    );
  });

  it("rejects corruption before the final line", async () => {
    const log = await createThreadLog();
    const logPath = log.getPath(conversationId);
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, [
      JSON.stringify({
        conversationId,
        createdAt: new Date().toISOString(),
        type: "thread_header",
        version: 1,
      }),
      "not-json",
      JSON.stringify({}),
      "",
    ].join("\n"), "utf8");

    expect(() => log.read(conversationId)).toThrow();
  });

  it("streams records larger than one read chunk without splitting UTF-8 text", async () => {
    const log = await createThreadLog();
    const content = `跨块内容-${"汉字".repeat(180_000)}`;

    log.append(conversationId, { payload: { content }, type: "user_message" });

    expect(log.read(conversationId)?.events[0]?.payload.content).toBe(content);
  });

  it("rejects a complete invalid final record without truncating it", async () => {
    const log = await createThreadLog();
    log.append(conversationId, { payload: { content: "kept" }, type: "user_message" });
    const logPath = log.getPath(conversationId);
    const invalidRecord = `${JSON.stringify({
      conversationId,
      createdAt: new Date().toISOString(),
      eventId: "00000000-0000-4000-8000-000000000002",
      payload: {},
      sequence: 3,
      type: "assistant_message",
      version: 1,
    })}\n`;
    await appendFile(logPath, invalidRecord, "utf8");
    const before = await readFile(logPath, "utf8");

    expect(() => log.read(conversationId)).toThrow("sequence must be 2");
    await expect(readFile(logPath, "utf8")).resolves.toBe(before);
  });

  it("moves a legacy flat log into the per-conversation directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-thread-log-legacy-"));
    temporaryDirectories.push(directory);
    const legacyPath = path.join(directory, `${conversationId}.jsonl`);
    await writeFile(legacyPath, `${JSON.stringify({
      conversationId,
      createdAt: new Date().toISOString(),
      type: "thread_header",
      version: 1,
    })}\n`, "utf8");

    const log = new ThreadLog(directory);

    expect(log.listConversationIds()).toEqual([conversationId]);
    await expect(readFile(log.getPath(conversationId), "utf8")).resolves.toContain(conversationId);
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reconstructs model-visible context from canonical message and tool events", async () => {
    const log = await createThreadLog();
    log.append(conversationId, {
      payload: {
        attachmentIds: ["attachment-1"],
        content: "用户看到的文本",
        modelContent: "模型还应看到的引用文本",
        runId: "run-1",
      },
      type: "user_message",
    });
    log.append(conversationId, {
      payload: {
        content: "我先读取文件。",
        providerState: {
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          payload: { id: "response-1" },
        },
        runId: "run-1",
        toolCalls: [{ arguments: "{\"path\":\"README.md\"}", id: "call-1", name: "read_file" }],
      },
      type: "assistant_message",
    });
    log.append(conversationId, {
      payload: { content: "# README", runId: "run-1", toolCallId: "call-1" },
      type: "tool_result",
    });
    log.append(conversationId, {
      payload: { coveredThroughSequence: 3, summary: "已读取 README" },
      type: "context_checkpoint",
    });

    const context = log.readContext(conversationId);
    expect(context?.checkpoint).toMatchObject({
      coveredThroughSequence: 3,
      summary: "已读取 README",
    });
    expect(context?.messages).toEqual([
        expect.objectContaining({
          attachmentIds: ["attachment-1"],
          content: "模型还应看到的引用文本",
          role: "user",
          sequence: 1,
        }),
        expect.objectContaining({
          content: "我先读取文件。",
          role: "assistant",
          toolCalls: [{ arguments: "{\"path\":\"README.md\"}", id: "call-1", name: "read_file" }],
        }),
        expect.objectContaining({
          content: "# README",
          role: "tool",
          toolCallId: "call-1",
        }),
      ]);
  });

  it("updates an already cached context incrementally after an append", async () => {
    const log = await createThreadLog();
    log.append(conversationId, {
      payload: { content: "第一条", runId: "run-1" },
      type: "user_message",
    });
    const fullRead = vi.spyOn(log, "read");
    const initial = log.readContext(conversationId);
    expect(fullRead).not.toHaveBeenCalled();
    log.append(conversationId, {
      payload: { content: "第一条回复", runId: "run-1", toolCalls: [] },
      type: "assistant_message",
    });

    const updated = log.readContext(conversationId);
    expect(updated).toBe(initial);
    expect(updated?.messages.map((message) => [message.role, message.content, message.sequence])).toEqual([
      ["user", "第一条", 1],
      ["assistant", "第一条回复", 2],
    ]);
  });

  it("keeps the explicit local checkpoint boundary before recent messages", async () => {
    const log = await createThreadLog();
    for (let index = 1; index <= 4; index += 1) {
      log.append(conversationId, {
        payload: { content: `消息 ${index}`, runId: `run-${index}` },
        type: index % 2 === 1 ? "user_message" : "assistant_message",
      });
    }
    log.append(conversationId, {
      payload: {
        coveredThroughContextSequence: 2,
        coveredThroughSequence: 42,
        summary: "只覆盖前两条",
      },
      type: "context_checkpoint",
    });

    expect(log.readContext(conversationId)?.checkpoint).toMatchObject({
      coveredThroughSequence: 2,
      summary: "只覆盖前两条",
    });
  });

  it("keeps one model-visible Agent message when delivery is retried", async () => {
    const log = await createThreadLog();
    const event = {
      payload: {
        content: "原始协作内容",
        messageId: "message-1",
        modelContent: "[Agent 协作消息]\n已完成依赖。",
        runId: "run-1",
        senderConversationId: "sender-1",
      },
      type: "agent_message" as const,
    };

    expect(log.appendIfMissing(conversationId, event, "messageId")).toMatchObject({ sequence: 1 });
    expect(log.appendIfMissing(conversationId, event, "messageId")).toBeNull();
    expect(log.readContext(conversationId)?.messages).toEqual([
      expect.objectContaining({
        content: "[Agent 协作消息]\n已完成依赖。",
        role: "user",
        runId: "run-1",
        sequence: 1,
      }),
    ]);
  });

  it("removes a superseded Run from model context but preserves its raw events", async () => {
    const log = await createThreadLog();
    log.append(conversationId, {
      payload: { content: "旧问题", messageId: "message-1", runId: "run-old" },
      type: "user_message",
    });
    log.append(conversationId, {
      payload: { content: "旧回答", runId: "run-old", toolCalls: [] },
      type: "assistant_message",
    });
    log.append(conversationId, {
      payload: { replacementRunId: "run-new", runId: "run-old" },
      type: "run_superseded",
    });
    log.append(conversationId, {
      payload: {
        content: "新问题",
        messageId: "message-1",
        modelContent: "新问题和引用",
        previousRunId: "run-old",
        runId: "run-new",
      },
      type: "user_message_replaced",
    });

    expect(log.read(conversationId)?.events.map((event) => event.type)).toEqual([
      "user_message",
      "assistant_message",
      "run_superseded",
      "user_message_replaced",
    ]);
    expect(log.readContext(conversationId)?.messages).toEqual([
      expect.objectContaining({
        content: "新问题和引用",
        role: "user",
        runId: "run-new",
        sequence: 1,
      }),
    ]);
  });
});
