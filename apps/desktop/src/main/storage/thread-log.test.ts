import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
    const initial = log.readContext(conversationId);
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
      }),
    ]);
  });
});
