import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { interrupt } from "@langchain/langgraph";

import type { ModelMessage, ModelTurnResult } from "../model/model-contracts.js";
import { NodeSqliteCheckpointSaver } from "../storage/node-sqlite-checkpoint-saver.js";
import { LangGraphExecutor, type AgentGraphCallbacks } from "./langgraph-executor.js";

const userMessage: ModelMessage = {
  attachments: [],
  content: "inspect the project",
  role: "user",
  toolCallId: null,
  toolCalls: [],
};

function result(content: string, toolCalls: ModelTurnResult["toolCalls"] = []): ModelTurnResult {
  return { content, finishReason: "stop", toolCalls };
}

function callbacksFor(
  results: ModelTurnResult[],
  executeTools: AgentGraphCallbacks["executeTools"] = (calls) => Promise.resolve({
    messages: calls.map((call) => ({
      attachments: [],
      content: `tool:${call.name}`,
      role: "tool" as const,
      toolCallId: call.id,
      toolCalls: [],
    })),
    successful: true,
  }),
): AgentGraphCallbacks {
  let index = 0;
  return {
    beforeModel: () => Promise.resolve({ hasFollowUpInput: false, messages: [] }),
    callModel: () => {
      const next = results[index];
      index += 1;
      if (next === undefined) throw new Error("Unexpected model call.");
      return Promise.resolve(next);
    },
    executeTools,
  };
}

describe("LangGraphExecutor", () => {
  it("routes a model tool call through tools and back to a final model turn", async () => {
    const callbacks = callbacksFor([
      result("", [{ arguments: "{}", id: "call-1", name: "read_file" }]),
      result("done"),
    ]);
    const graph = new LangGraphExecutor();

    const state = await graph.invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "run-1",
    });

    expect(state.turns).toBe(2);
    expect(state.hasSuccessfulToolExecution).toBe(true);
    expect(state.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      "user:inspect the project",
      "assistant:",
      "tool:tool:read_file",
      "assistant:done",
    ]);
  });

  it("allows a callback to inject a queued follow-up before the next model turn", async () => {
    let preparationCount = 0;
    const callbacks = callbacksFor([result("first"), result("second")]);
    callbacks.beforeModel = () => {
      preparationCount += 1;
      return Promise.resolve(preparationCount === 1
        ? {
            hasFollowUpInput: true,
            messages: [{ ...userMessage, content: "follow up" }],
          }
        : { hasFollowUpInput: false, messages: [] });
    };

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "run-2",
    });

    expect(state.turns).toBe(2);
    expect(state.messages.map((message) => message.content)).toEqual([
      "inspect the project",
      "follow up",
      "first",
      "second",
    ]);
  });

  it("fails at the graph boundary when the bounded step count is exhausted", async () => {
    const callbacks = callbacksFor([
      result("", [{ arguments: "{}", id: "call-1", name: "read_file" }]),
      result("", [{ arguments: "{}", id: "call-2", name: "read_file" }]),
    ]);

    await expect(new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 1,
      signal: new AbortController().signal,
      threadId: "run-3",
    })).rejects.toThrow("Agent exceeded the 1-turn tool loop limit.");
  });

  it("persists graph checkpoints with a parent chain that survives saver reopening", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-langgraph-checkpoint-"));
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const saver = new NodeSqliteCheckpointSaver(databasePath);
    try {
      const callbacks = callbacksFor([result("first")]);
      const state = await new LangGraphExecutor().invoke({
        callbacks,
        checkpointer: saver,
        initialMessages: [userMessage],
        maxSteps: 4,
        signal: new AbortController().signal,
        threadId: "checkpoint-run",
      });

      expect(state.turns).toBe(1);
      const latest = await saver.getTuple({ configurable: { thread_id: "checkpoint-run" } });
      expect(latest?.config.configurable?.thread_id).toBe("checkpoint-run");
      expect(latest?.checkpoint.channel_values).toHaveProperty("messages");
      expect(latest?.parentConfig?.configurable?.thread_id).toBe("checkpoint-run");
      const checkpoints = [];
      for await (const tuple of saver.list({ configurable: { thread_id: "checkpoint-run" } })) {
        checkpoints.push(tuple);
      }
      expect(checkpoints.length).toBeGreaterThan(1);
    } finally {
      saver.close();
    }

    const reopened = new NodeSqliteCheckpointSaver(databasePath);
    try {
      await expect(reopened.getTuple({ configurable: { thread_id: "checkpoint-run" } }))
        .resolves.toBeDefined();
    } finally {
      reopened.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("resumes sequential interrupts in one tool node without replaying the approval callback", async () => {
    let interruptCount = 0;
    const callbacks = callbacksFor(
      [
        result("", [{ arguments: "{}", id: "call-approval", name: "write_file" }]),
        result("approved"),
      ],
      (calls) => {
        const first = interrupt<{ step: number }, boolean>({ step: 1 });
        const second = interrupt<{ step: number }, boolean>({ step: 2 });
        return Promise.resolve({
          messages: calls.map((call) => ({
            attachments: [],
            content: `approved:${first && second}`,
            role: "tool" as const,
            toolCallId: call.id,
            toolCalls: [],
          })),
          successful: first && second,
        });
      },
    );

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      onInterrupt: () => {
        interruptCount += 1;
        return Promise.resolve(true);
      },
      signal: new AbortController().signal,
      threadId: "sequential-approval-run",
    });

    expect(interruptCount).toBe(2);
    expect(state.hasSuccessfulToolExecution).toBe(true);
    expect(state.messages.some((message) => message.content === "approved:true")).toBe(true);
  });
});
