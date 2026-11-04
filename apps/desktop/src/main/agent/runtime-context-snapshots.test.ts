import { expect, it } from "vitest";
import type { ModelMessage } from "../model/model-contracts.js";
import { changedRuntimeContexts } from "./runtime-context-snapshots.js";

const message = (content: string): ModelMessage => ({ content, role: "user", attachments: [], toolCallId: null, toolCalls: [] });
const empty = { queue: null, skills: null, checklist: null, directory: null };

it("keeps stable request history in place instead of moving the same skill/directory suffix after every tool", () => {
  const current = { ...empty, skills: message("active instructions"), directory: message("task revision 1") };
  const first = [message("request"), ...changedRuntimeContexts([], current)];
  const next = [...first, { ...message("tool evidence"), role: "tool" as const, toolCallId: "call-1" }];
  expect(changedRuntimeContexts(next, current)).toEqual([]);
  const updated = changedRuntimeContexts(next, { ...current, directory: message("task revision 2") });
  expect(updated).toEqual([expect.objectContaining({ runtimeContext: "directory" })]);
  expect(updated[0]?.content).toContain("task revision 2");
  expect(updated[0]?.content).toContain("supersedes earlier directory snapshots");
  expect([...next, ...updated].slice(0, first.length)).toEqual(first);
});

it("explicitly clears removed runtime state, only once, and reintroduces active state after compaction", () => {
  const first = changedRuntimeContexts([], { ...empty, checklist: message("running") });
  const cleared = changedRuntimeContexts(first, empty);
  expect(cleared).toHaveLength(1);
  expect(cleared[0]?.content).toContain("No active entries");
  expect(changedRuntimeContexts([...first, ...cleared], empty)).toEqual([]);
  expect(changedRuntimeContexts([], { ...empty, skills: message("restored instructions") })).toHaveLength(1);
  expect(changedRuntimeContexts([], empty)).toEqual([]);
});
