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

  it("prepares the initial context once and keeps it across a queued follow-up", async () => {
    let beforeAgentCount = 0;
    let beforeModelCount = 0;
    const callbacks = callbacksFor([result("first"), result("second")]);
    callbacks.beforeAgent = () => {
      beforeAgentCount += 1;
      return Promise.resolve({ messages: [{ ...userMessage, content: "prepared context" }] });
    };
    callbacks.beforeModel = () => {
      beforeModelCount += 1;
      return Promise.resolve({
        hasFollowUpInput: beforeModelCount === 1,
        messages: [],
      });
    };

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "before-agent-context-run",
    });

    expect(beforeAgentCount).toBe(1);
    expect(beforeModelCount).toBe(2);
    expect(state.contextPrepared).toBe(true);
    expect(state.messages.map((message) => message.content)).toEqual([
      "prepared context",
      "first",
      "second",
    ]);
  });

  it("keeps mutable runtime context behind stable history across model turns", async () => {
    const modelRequests: string[][] = [];
    let beforeModelCount = 0;
    const callbacks = callbacksFor([
      result("", [{ arguments: "{}", id: "call-1", name: "update_task_list" }]),
      result("done"),
    ]);
    callbacks.beforeAgent = () => Promise.resolve({
      messages: [
        {
          attachments: [],
          content: "stable system",
          role: "system",
          toolCallId: null,
          toolCalls: [],
        },
        { ...userMessage, content: "large stable history" },
      ],
    });
    callbacks.beforeModel = () => {
      beforeModelCount += 1;
      return Promise.resolve({
        contextMessages: [
          {
            attachments: [],
            content: "active skill",
            role: "system",
            toolCallId: null,
            toolCalls: [],
          },
          {
            attachments: [],
            content: `current task list v${beforeModelCount}`,
            role: "user",
            toolCallId: null,
            toolCalls: [],
          },
        ],
        hasFollowUpInput: false,
        messages: [],
      });
    };
    callbacks.callModel = (messages) => {
      modelRequests.push(messages.map((message) => message.content));
      return Promise.resolve(modelRequests.length === 1
        ? result("", [{ arguments: "{}", id: "call-1", name: "update_task_list" }])
        : result("done"));
    };

    await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "cache-stable-runtime-context-run",
    });

    expect(modelRequests[0]).toEqual([
      "stable system",
      "active skill",
      "large stable history",
      "current task list v1",
    ]);
    expect(modelRequests[1]).toEqual([
      "stable system",
      "active skill",
      "large stable history",
      "",
      "tool:update_task_list",
      "current task list v2",
    ]);
  });

  it("retries transient model failures inside middleware without consuming extra graph turns", async () => {
    let calls = 0;
    const retries: Array<{ attempt: number; delayMs: number; requestId: string }> = [];
    let completedRetry: { attempt: number; requestId: string } | null = null;
    const callbacks = callbacksFor([result("done")]);
    callbacks.callModel = () => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error("transient"));
      return Promise.resolve(result("done"));
    };

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      modelRetry: {
        getDelay: (attempt) => attempt * 10,
        maxRetries: 2,
        onRetry: ({ attempt, delayMs, requestId }) => {
          retries.push({ attempt, delayMs, requestId });
        },
        onSuccess: (input) => {
          completedRetry = input;
        },
        shouldRetry: (error) => error instanceof Error && error.message === "transient",
        wait: () => Promise.resolve(),
      },
      signal: new AbortController().signal,
      threadId: "middleware-retry-run",
    });

    expect(calls).toBe(3);
    expect(retries.map(({ attempt, delayMs }) => ({ attempt, delayMs }))).toEqual([
      { attempt: 1, delayMs: 10 },
      { attempt: 2, delayMs: 20 },
    ]);
    expect(retries[0]?.requestId).toBe(retries[1]?.requestId);
    expect(completedRetry).toEqual({ attempt: 2, requestId: retries[0]?.requestId });
    expect(state.turns).toBe(1);
    expect(state.lastResult?.content).toBe("done");
  });

  it("does not retry a model failure after a streamed text delta", async () => {
    let calls = 0;
    let failures = 0;
    const callbacks = callbacksFor([]);
    callbacks.callModel = (_messages, _turn, hooks) => {
      calls += 1;
      hooks?.onTextDelta?.();
      return Promise.reject(new Error("stream ended"));
    };

    await expect(new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      modelRetry: {
        getDelay: () => 1,
        maxRetries: 5,
        onFailure: () => {
          failures += 1;
        },
        onRetry: () => undefined,
        shouldRetry: () => true,
        wait: () => Promise.resolve(),
      },
      signal: new AbortController().signal,
      threadId: "middleware-stream-failure-run",
    })).rejects.toThrow("stream ended");

    expect(calls).toBe(1);
    expect(failures).toBe(1);
  });

  it("passes one model tool batch to the Runtime exactly once", async () => {
    const executedBatches: string[][] = [];
    const callbacks = callbacksFor(
      [
        result("", [
          { arguments: "{}", id: "call-1", name: "read_file" },
          { arguments: "{}", id: "call-2", name: "search_text" },
          { arguments: "{}", id: "call-3", name: "run_command" },
        ]),
        result("done"),
      ],
      (calls) => {
        executedBatches.push(calls.map((call) => call.id));
        return Promise.resolve({
          messages: calls.map((call) => ({
            attachments: [],
            content: `tool:${call.name}`,
            role: "tool" as const,
            toolCallId: call.id,
            toolCalls: [],
          })),
          successful: true,
        });
      },
    );

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "batched-tools-run",
    });

    expect(executedBatches).toEqual([["call-1", "call-2", "call-3"]]);
    expect(state.messages.filter((message) => message.role === "tool").map((message) => message.toolCallId))
      .toEqual(["call-1", "call-2", "call-3"]);
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

  it("keeps a multi-tool loop bounded by the model-turn limit", async () => {
    let modelCalls = 0;
    const callbacks = callbacksFor([]);
    callbacks.callModel = () => {
      modelCalls += 1;
      return Promise.resolve(result("", [
        { arguments: "{}", id: `call-${modelCalls}`, name: "read_file" },
        { arguments: "{}", id: `call-${modelCalls}-search`, name: "search_text" },
        { arguments: "{}", id: `call-${modelCalls}-command`, name: "run_command" },
      ]));
    };

    await expect(new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 8,
      signal: new AbortController().signal,
      threadId: "multi-tool-loop-limit-run",
    })).rejects.toMatchObject({
      code: "MODEL_CALL_LIMIT_EXCEEDED",
    });
    expect(modelCalls).toBe(8);
  });

  it("keeps a successful tool result in graph state after a later tool failure", async () => {
    const callbacks = callbacksFor(
      [
        result("", [{ arguments: "{}", id: "call-1", name: "read_file" }]),
        result("", [{ arguments: "{}", id: "call-2", name: "read_file" }]),
        result("done"),
      ],
      (calls) => Promise.resolve({
        messages: calls.map((call) => ({
          attachments: [],
          content: `tool:${call.name}`,
          role: "tool" as const,
          toolCallId: call.id,
          toolCalls: [],
        })),
        successful: calls[0]?.id === "call-1",
      }),
    );

    const state = await new LangGraphExecutor().invoke({
      callbacks,
      initialMessages: [userMessage],
      maxSteps: 4,
      signal: new AbortController().signal,
      threadId: "successful-tool-state-run",
    });

    expect(state.hasSuccessfulToolExecution).toBe(true);
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
