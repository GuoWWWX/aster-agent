import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelProviderState } from "../model/model-contracts.js";
import { ConversationHistoryRepository } from "./conversation-history-repository.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`CREATE TABLE model_messages (
    sequence INTEGER PRIMARY KEY, conversation_id TEXT, run_id TEXT, role TEXT,
    content TEXT, tool_calls_json TEXT, tool_call_id TEXT,
    attachment_ids_json TEXT, provider_state_json TEXT
  )`);
  const insert = (sequence: number, conversationId: string, content: string, options: {
    attachmentIds?: unknown[];
    providerState?: ModelProviderState;
    role?: string;
    runId?: string;
    toolCallsJson?: string;
  } = {}) => database.prepare("INSERT INTO model_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sequence, conversationId, options.runId ?? "run-a", options.role ?? "user", content,
      options.toolCallsJson ?? "[]", null, JSON.stringify(options.attachmentIds ?? []),
      options.providerState === undefined ? null : JSON.stringify(options.providerState));
  return { database, history: new ConversationHistoryRepository(database), insert };
}

describe("ConversationHistoryRepository", () => {
  it("keeps a bounded newest window chronological and converts conversation-local positions", () => {
    const { history, insert } = fixture();
    insert(1, "a", "first");
    insert(2, "b", "other conversation");
    insert(3, "a", "second", { role: "assistant" });
    insert(6, "a", "third", { runId: "run-b" });
    insert(8, "a", "last", { role: "assistant", runId: "run-b" });

    expect(history.listContextMessagesPage({ conversationId: "a", limit: 2 })
      .map(message => message.sequence)).toEqual([6, 8]);
    expect(history.listContextMessagesPage({ conversationId: "a", limit: 2,
      afterSequence: 1, beforeSequence: 8 }).map(message => message.sequence)).toEqual([3, 6]);
    expect(history.countContextMessages({ conversationId: "a", afterSequence: 1, beforeSequence: 8 })).toBe(2);
    expect(history.resolveContextCheckpointSequence("a", 3)).toBe(6);
    expect(history.getLatestContextUserMessage("a")).toMatchObject({ content: "third", sequence: 6 });
    expect(history.getLatestContextUserMessage("missing")).toBeNull();
    expect(history.listContextMessagesForRun("run-b").map(message => message.content))
      .toEqual(["third", "last"]);
    expect(() => history.resolveContextCheckpointSequence("a", 5)).toThrow("no stored database message");
  });

  it("rejects invalid pagination and local checkpoint positions", () => {
    const { history } = fixture();
    for (const limit of [0, 1_001, 1.5, Number.NaN]) {
      expect(() => history.listContextMessagesPage({ conversationId: "a", limit })).toThrow("page limit");
    }
    expect(() => history.listContextMessagesPage({ conversationId: "a", limit: 1,
      afterSequence: -1 })).toThrow("afterSequence");
    expect(() => history.listContextMessagesPage({ conversationId: "a", limit: 1,
      beforeSequence: 0 })).toThrow("beforeSequence");
    expect(() => history.resolveContextCheckpointSequence("a", 0)).toThrow("positive integer");
  });

  it("does not broaden escaped identifier searches or cross the requested history boundary", () => {
    const { history, insert } = fixture();
    insert(1, "a", "The src/login_form.tsx component.");
    insert(2, "a", "The src/loginXform.tsx component.");
    insert(3, "b", "The src/login_form.tsx component.");
    insert(4, "a", "The src/login_form.tsx component.");
    const query = { conversationId: "a", query: "src/login_form.tsx" };

    expect(history.searchContextMessages({ ...query, beforeSequence: 4 })
      .map(message => message.sequence)).toEqual([1]);
    expect(history.searchContextMessages({ ...query, excludeSequences: [1, 1, -1], limit: 1 })
      .map(message => message.sequence)).toEqual([4]);
    expect(() => history.searchContextMessages({ ...query, limit: 101 })).toThrow("search limit");
    expect(() => history.searchContextMessages({ ...query, beforeSequence: 0 })).toThrow("beforeSequence");
    expect(history.searchContextMessages({ ...query, query: " " })).toEqual([]);
  });

  it("reads usage and attachment metadata without parsing unrelated tool bodies", () => {
    const { history, insert } = fixture();
    const providerState: ModelProviderState = {
      apiFormat: "openai-responses", baseUrl: "https://example.test/v1", modelId: "fixture",
      payload: null, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 80 },
    };
    insert(1, "a", "user", { attachmentIds: ["one", "one", 42], toolCallsJson: "invalid-json" });
    insert(2, "a", "assistant", { attachmentIds: ["two"], role: "assistant", providerState });
    insert(3, "b", "other", { attachmentIds: ["other"], role: "assistant", providerState });

    expect(history.listAssistantProviderStates("a")).toEqual([providerState]);
    expect(history.listContextAttachmentIds("a")).toEqual(["one", "two"]);
    expect(history.listContextMessagesPage({ conversationId: "a", afterSequence: 1, limit: 1 })[0])
      .toMatchObject({ content: "assistant", role: "assistant", attachmentIds: ["two"], providerState });
    expect(() => history.listContextMessages("a")).toThrow("model tool calls");
  });
});
