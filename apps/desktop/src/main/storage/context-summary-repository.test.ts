import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextSummaryRepository } from "./context-summary-repository.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE model_messages (sequence INTEGER PRIMARY KEY, conversation_id TEXT, run_id TEXT);
    CREATE TABLE conversation_context_checkpoints (
      conversation_id TEXT PRIMARY KEY, covered_through_sequence INTEGER,
      summary TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE conversation_turn_summaries (
      run_id TEXT PRIMARY KEY, conversation_id TEXT, covered_through_sequence INTEGER,
      summary TEXT, created_at TEXT
    );
    INSERT INTO model_messages VALUES (1, 'a', 'run-a'), (2, 'b', 'run-b'),
      (3, 'a', 'run-a'), (4, 'a', 'run-c');
  `);
  return new ContextSummaryRepository(database);
}

describe("ContextSummaryRepository", () => {
  it("prepares without writing and preserves durable timestamps when projecting or replaying", () => {
    const summaries = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:00:00.000Z"));
    const prepared = summaries.prepareContextCheckpoint("a", 1, "  first  ");
    expect(prepared).toMatchObject({ summary: "first", createdAt: "2026-10-19T00:00:00.000Z" });
    expect(summaries.getContextCheckpoint("a")).toBeNull();
    vi.setSystemTime(new Date("2026-10-19T01:00:00.000Z"));
    expect(summaries.projectPreparedContextCheckpoint(prepared)).toEqual(prepared);
    expect(summaries.projectPreparedContextCheckpoint(prepared)).toEqual(prepared);

    const next = summaries.prepareContextCheckpoint("a", 3, "second");
    expect(next).toMatchObject({ createdAt: prepared.createdAt, updatedAt: "2026-10-19T01:00:00.000Z" });
    expect(summaries.projectPreparedContextCheckpoint(next)).toEqual(next);
  });

  it("keeps the prior checkpoint and original boundary when preparation or materialization fails", () => {
    const summaries = fixture();
    const saved = summaries.projectPreparedContextCheckpoint(summaries.prepareContextCheckpoint("a", 3, "valid"));
    expect(() => summaries.prepareContextCheckpoint("a", 2, "wrong conversation"))
      .toThrow("stored conversation message");
    expect(() => summaries.prepareContextCheckpoint("a", 1, "older"))
      .toThrow("coverage cannot move backwards");
    expect(() => summaries.projectPreparedContextCheckpoint({ ...saved, coveredThroughSequence: 1 }))
      .toThrow("coverage cannot move backwards");
    expect(() => summaries.projectPreparedContextCheckpoint({ ...saved, coveredThroughSequence: 2 }))
      .toThrow("stored conversation message");
    expect(() => summaries.projectPreparedContextCheckpoint({ ...saved, summary: " " }))
      .toThrow("invalid length");
    expect(summaries.getContextCheckpoint("a")).toEqual(saved);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects an invalid checkpoint boundary %s before writing", boundary => {
    const summaries = fixture();
    expect(() => summaries.prepareContextCheckpoint("a", boundary, "valid")).toThrow("positive integer");
    expect(summaries.getContextCheckpoint("a")).toBeNull();
  });

  it("selects a turn summary inside its covered boundary and preserves its initial creation time on update", () => {
    const summaries = fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:00:00.000Z"));
    const saved = summaries.saveConversationTurnSummary({
      conversationId: "a", runId: "run-a", coveredThroughSequence: 1, summary: "  first  ",
    });
    vi.setSystemTime(new Date("2026-10-19T01:00:00.000Z"));
    const updated = summaries.saveConversationTurnSummary({
      conversationId: "a", runId: "run-a", coveredThroughSequence: 3, summary: "updated",
    });
    expect(updated).toMatchObject({ createdAt: saved.createdAt, summary: "updated", coveredThroughSequence: 3 });
    summaries.saveConversationTurnSummary({
      conversationId: "a", runId: "run-c", coveredThroughSequence: 4, summary: "latest",
    });
    expect(summaries.getLatestConversationTurnSummary("a", 2)).toBeNull();
    expect(summaries.getLatestConversationTurnSummary("a", 3)).toEqual(updated);
    expect(summaries.getLatestConversationTurnSummary("a", 4)?.runId).toBe("run-c");
    expect(summaries.getConversationTurnSummary("run-a")).toEqual(updated);
    expect(summaries.getConversationTurnSummary("missing")).toBeNull();
  });

  it("rejects turn summaries belonging to a different conversation or Run without replacing prior data", () => {
    const summaries = fixture();
    const input = { conversationId: "a", runId: "run-a", coveredThroughSequence: 3, summary: "valid" };
    const saved = summaries.saveConversationTurnSummary(input);
    expect(() => summaries.saveConversationTurnSummary({ ...input, coveredThroughSequence: 2 }))
      .toThrow("must belong to its Run");
    expect(() => summaries.saveConversationTurnSummary({ ...input, runId: "run-c" }))
      .toThrow("must belong to its Run");
    expect(() => summaries.saveConversationTurnSummary({ ...input, summary: " " })).toThrow("invalid length");
    expect(summaries.getConversationTurnSummary("run-a")).toEqual(saved);
  });
});
