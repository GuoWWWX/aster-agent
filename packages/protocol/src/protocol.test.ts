import { describe, expect, it } from "vitest";

import {
  capabilitySetSchema,
  agentPermissionRuleSchema,
  approveToolChangeInputSchema,
  clipboardWriteTextIpcArgumentsSchema,
  contextCompressionConfigurationSchema,
  contextCompressionThresholdSchema,
  conversationContextUsageInputSchema,
  conversationContextUsageSchema,
  conversationRunEventSchema,
  conversationSummarySchema,
  conversationTaskListSchema,
  createProjectEntryInputSchema,
  createConversationInputSchema,
  emptyIpcArgumentsSchema,
  forkConversationInputSchema,
  IPC_CHANNELS,
  isReasoningOptionEnabled,
  isReasoningOptionSupportedByApiFormat,
  listProjectEntriesInputSchema,
  pluginCatalogEntrySchema,
  runtimeInfoSchema,
  resolveContextCompressionThresholdTokens,
  replaceLatestConversationMessageInputSchema,
  saveModelConfigurationInputSchema,
  setDefaultModelInputSchema,
  setConversationModelSelectionInputSchema,
  testModelConnectionInputSchema,
  setConversationProjectInputSchema,
  sendConversationMessageInputSchema
} from "./index.js";

describe("protocol bootstrap contract", () => {
  it("validates scoped approval and Agent allow rules", () => {
    expect(approveToolChangeInputSchema.parse({
      approved: true,
      runId: "00000000-0000-4000-8000-000000000001",
      toolId: "00000000-0000-4000-8000-000000000002",
    }).scope).toBe("once");
    expect(approveToolChangeInputSchema.parse({
      approved: true,
      runId: "00000000-0000-4000-8000-000000000001",
      scope: "agent",
      toolId: "00000000-0000-4000-8000-000000000002",
    }).scope).toBe("agent");
    expect(agentPermissionRuleSchema.parse({ tool: "run_command", pattern: "mvn package *" }))
      .toEqual({ pattern: "mvn package *", tool: "run_command" });
    expect(() => agentPermissionRuleSchema.parse({ tool: "run_command", pattern: "mvn * test" }))
      .toThrow();
    expect(() => approveToolChangeInputSchema.parse({
      approved: true,
      runId: "00000000-0000-4000-8000-000000000001",
      scope: "global",
      toolId: "00000000-0000-4000-8000-000000000002",
    })).toThrow();
  });

  it("bounds clipboard text at the IPC boundary", () => {
    expect(clipboardWriteTextIpcArgumentsSchema.parse(["# reply\n"])).toEqual(["# reply\n"]);
    expect(() => clipboardWriteTextIpcArgumentsSchema.parse(["x".repeat(2_000_001)])).toThrow();
  });

  it("keeps Plugin catalog records declarative and redacts managed paths", () => {
    expect(pluginCatalogEntrySchema.parse({
      contentHash: "a".repeat(64),
      enabled: true,
      id: "example.plugin",
      name: "Example Plugin",
      updatedAt: "2026-08-27T00:00:00.000Z",
      version: "1.0.0",
    })).toMatchObject({ id: "example.plugin" });
    expect(() => pluginCatalogEntrySchema.parse({
      contentHash: "a".repeat(64),
      enabled: true,
      id: "example.plugin",
      name: "Example Plugin",
      rootPath: "C:\\Users\\example\\.agent\\plugins\\example",
      updatedAt: "2026-08-27T00:00:00.000Z",
      version: "1.0.0",
    })).toThrow();
  });

  it("validates a configured model connection test request", () => {
    expect(testModelConnectionInputSchema.parse({
      modelId: "gpt-5.6",
      providerId: "00000000-0000-4000-8000-000000000001",
    })).toMatchObject({ modelId: "gpt-5.6" });
    expect(() => testModelConnectionInputSchema.parse({
      modelId: "",
      providerId: "invalid",
    })).toThrow();
  });

  it("validates persisted conversation model selections", () => {
    const selection = {
      modelId: "gpt-5.6",
      providerId: "00000000-0000-4000-8000-000000000001",
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    expect(setConversationModelSelectionInputSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000002",
      modelSelection: selection,
    }).modelSelection).toEqual(selection);
    expect(() => setConversationModelSelectionInputSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000002",
      modelSelection: { ...selection, providerId: "invalid" },
    })).toThrow();
  });

  it("accepts the minimal desktop runtime contract", () => {
    const runtime = runtimeInfoSchema.parse({
      appVersion: "0.1.0",
      platform: "win32",
      capabilities: {
        mode: "desktop",
        workspace: false,
        fileWrite: false,
        process: false,
        pty: false,
        git: false,
        managedBrowser: false,
        mcp: false,
        skills: false,
        docxConversion: false
      }
    });

    expect(runtime.platform).toBe("win32");
    expect(IPC_CHANNELS.windowToggleMaximize).toBe("window.toggle_maximize");
  });

  it("rejects undeclared capability fields", () => {
    expect(() =>
      capabilitySetSchema.parse({
        mode: "mock",
        workspace: false,
        fileWrite: false,
        process: false,
        pty: false,
        git: false,
        managedBrowser: false,
        mcp: false,
        skills: false,
        docxConversion: false,
        shell: true
      }),
    ).toThrow();
  });

  it("rejects IPC arguments during bootstrap", () => {
    expect(() => emptyIpcArgumentsSchema.parse(["unexpected"])).toThrow();
  });

  it("validates project entry creation paths", () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    expect(createProjectEntryInputSchema.parse({
      kind: "file",
      path: "src/new-file.ts",
      projectId,
    })).toEqual({ kind: "file", path: "src/new-file.ts", projectId });
    expect(() => createProjectEntryInputSchema.parse({
      kind: "directory",
      path: "../outside",
      projectId,
    })).toThrow();
  });

  it("accepts project-free temporary conversations", () => {
    expect(createConversationInputSchema.parse({})).toEqual({});
    expect(
      conversationSummarySchema.parse({
        activeRunId: null,
        createdAt: "2026-08-15T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
        lastRunStatus: null,
        projectId: null,
        title: "临时对话",
        updatedAt: "2026-08-15T00:00:00.000Z"
      })
    ).toMatchObject({
      activeSubagentCount: 0,
      archivedAt: null,
      hasUnreadResult: false,
      threadKind: "agent",
    });
    expect(
      conversationSummarySchema.parse({
        activeRunId: null,
        createdAt: "2026-08-15T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
        lastRunStatus: null,
        projectId: null,
        title: "临时对话",
        updatedAt: "2026-08-15T00:00:00.000Z"
      }).projectId
    ).toBeNull();
  });

  it("validates Agent thread identity at the protocol boundary", () => {
    const agent = {
      id: "team-lead",
      instructions: "负责拆分和汇总任务。",
      isDefault: false,
      name: "Team Lead",
      role: "团队负责人",
    };

    expect(createConversationInputSchema.parse({
      agent,
      teamId: "default-team",
      threadKind: "team_lead",
    })).toMatchObject({ agent, teamId: "default-team", threadKind: "team_lead" });
    expect(() => createConversationInputSchema.parse({
      agent,
      threadKind: "team_lead",
    })).toThrow("must belong to a team");
    expect(createConversationInputSchema.parse({
      threadKind: "agent",
    })).toEqual({ threadKind: "agent" });
    expect(() => createConversationInputSchema.parse({
      teamId: "default-team",
      threadKind: "agent",
    })).toThrow("must identify its Agent profile");
    expect(() => createConversationInputSchema.parse({
      threadKind: "subagent",
    })).toThrow();
  });

  it("validates conversation project assignment", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const projectId = "00000000-0000-4000-8000-000000000002";

    expect(setConversationProjectInputSchema.parse({ conversationId, projectId }))
      .toEqual({ conversationId, projectId });
    expect(setConversationProjectInputSchema.parse({ conversationId, projectId: null }))
      .toEqual({ conversationId, projectId: null });
    expect(() => setConversationProjectInputSchema.parse({ conversationId }))
      .toThrow();
  });

  it("validates optional assistant-message boundaries for conversation forks", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const throughMessageId = "00000000-0000-4000-8000-000000000002";

    expect(forkConversationInputSchema.parse({ conversationId })).toEqual({ conversationId });
    expect(forkConversationInputSchema.parse({ conversationId, throughMessageId })).toEqual({
      conversationId,
      throughMessageId,
    });
    expect(() => forkConversationInputSchema.parse({
      conversationId,
      throughMessageId: "not-a-message-id",
    })).toThrow();
    expect(() => forkConversationInputSchema.parse({
      conversationId,
      throughMessageId,
      includeFutureMessages: true,
    })).toThrow();
  });

  it("treats task lists saved before lifecycle support as active", () => {
    const taskList = conversationTaskListSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      tasks: [{
        id: "00000000-0000-4000-8000-000000000002",
        status: "running",
        title: "分析需求"
      }],
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    expect(taskList.closedAt).toBeNull();
    expect(taskList.status).toBe("active");
  });

  it("accepts blocked and failed task states for persisted task lists", () => {
    const taskList = conversationTaskListSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      tasks: [
        { id: "00000000-0000-4000-8000-000000000002", reason: "等待用户确认写入", status: "blocked", title: "等待用户审批" },
        { id: "00000000-0000-4000-8000-000000000003", reason: "构建命令退出", status: "failed", title: "工具执行失败" },
      ],
      updatedAt: "2026-08-27T00:00:00.000Z",
    });

    expect(taskList.tasks.map((task) => task.status)).toEqual(["blocked", "failed"]);
    expect(taskList.tasks.map((task) => task.reason)).toEqual(["等待用户确认写入", "构建命令退出"]);
  });

  it("keeps task lists saved before task reasons compatible", () => {
    const taskList = conversationTaskListSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      tasks: [{ id: "00000000-0000-4000-8000-000000000002", status: "blocked", title: "等待输入" }],
      updatedAt: "2026-08-27T00:00:00.000Z",
    });

    expect(taskList.tasks[0]?.reason).toBeNull();
    expect(() => conversationTaskListSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      tasks: [{
        id: "00000000-0000-4000-8000-000000000002",
        reason: "不应保留",
        status: "running",
        title: "执行中",
      }],
      updatedAt: "2026-08-27T00:00:00.000Z",
    })).toThrow("Only blocked and failed tasks may include a reason.");
  });

  it("accepts per-run model, permission and reasoning settings", () => {
    expect(
      sendConversationMessageInputSchema.parse({
        content: "检查项目",
        conversationId: "00000000-0000-4000-8000-000000000001",
        modelId: "gpt-5.6",
        permissionMode: "ask_before_changes",
        reasoning: { kind: "effort", value: "high" }
      })
    ).toMatchObject({
      modelId: "gpt-5.6",
      permissionMode: "ask_before_changes",
      reasoning: { kind: "effort", value: "high" }
    });
  });

  it("validates replacement of the latest sent user message", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const messageId = "00000000-0000-4000-8000-000000000002";

    expect(replaceLatestConversationMessageInputSchema.parse({
      content: "修改后的任务",
      conversationId,
      messageId,
      permissionMode: "ask_before_changes",
    })).toEqual({
      content: "修改后的任务",
      conversationId,
      messageId,
      permissionMode: "ask_before_changes",
    });
    expect(() => replaceLatestConversationMessageInputSchema.parse({
      content: "",
      conversationId,
      messageId,
    })).toThrow();
    expect(() => replaceLatestConversationMessageInputSchema.parse({
      content: "无效引用",
      conversationId,
      messageId,
      referencedConversationIds: [conversationId],
    })).toThrow("cannot reference itself");
  });

  it("carries an applied project file change on a completed tool event", () => {
    const event = conversationRunEventSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      fileChange: {
        operation: "write_file",
        path: "src/new-file.ts",
        projectId: "00000000-0000-4000-8000-000000000002",
      },
      runId: "00000000-0000-4000-8000-000000000003",
      tool: {
        arguments: "{}",
        batchId: null,
        conversationId: "00000000-0000-4000-8000-000000000001",
        createdAt: "2026-08-17T00:00:00.000Z",
        diff: "--- a/src/new-file.ts\n+++ b/src/new-file.ts",
        executionMode: "parallel",
        id: "00000000-0000-4000-8000-000000000004",
        kind: "tool",
        name: "write_file",
        result: "{}",
        runId: "00000000-0000-4000-8000-000000000003",
        status: "completed",
      },
      type: "tool.completed",
    });

    expect(event.type).toBe("tool.completed");
    if (event.type !== "tool.completed") throw new Error("Expected a completed tool event.");
    expect(event.fileChange).toEqual({
      operation: "write_file",
      path: "src/new-file.ts",
      projectId: "00000000-0000-4000-8000-000000000002",
    });
    expect(event.tool.executionMode).toBe("parallel");
  });

  it("accepts a streamed command output event", () => {
    expect(conversationRunEventSchema.parse({
      commandId: "00000000-0000-4000-8000-000000000005",
      conversationId: "00000000-0000-4000-8000-000000000001",
      delta: "正在输出\n",
      done: false,
      exitCode: null,
      runId: "00000000-0000-4000-8000-000000000003",
      status: "running",
      stream: "stdout",
      timedOut: false,
      toolId: "00000000-0000-4000-8000-000000000004",
      type: "tool.output_delta",
      truncated: false,
    })).toMatchObject({
      delta: "正在输出\n",
      done: false,
      exitCode: null,
      status: "running",
      stream: "stdout",
      timedOut: false,
      type: "tool.output_delta",
      truncated: false,
    });
  });

  it("carries a replaceable reasoning preview delta", () => {
    expect(conversationRunEventSchema.parse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      delta: "正在检查模型适配器",
      kind: "summary",
      reset: true,
      runId: "00000000-0000-4000-8000-000000000002",
      type: "assistant.reasoning_delta"
    })).toMatchObject({
      delta: "正在检查模型适配器",
      kind: "summary",
      reset: true,
      type: "assistant.reasoning_delta"
    });
  });

  it("accepts attachment-only messages and rejects completely empty messages", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const attachmentId = "00000000-0000-4000-8000-000000000002";
    expect(sendConversationMessageInputSchema.parse({
      attachmentIds: [attachmentId],
      content: "",
      conversationId,
    })).toEqual({ attachmentIds: [attachmentId], content: "", conversationId });
    expect(() => sendConversationMessageInputSchema.parse({
      content: "",
      conversationId,
    })).toThrow("text, an attachment, or a project file reference");
  });

  it("accepts unique project file references and rejects invalid paths", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    expect(sendConversationMessageInputSchema.parse({
      content: "",
      conversationId,
      referencedProjectPaths: ["apps/web/src/app.tsx"],
    }).referencedProjectPaths).toEqual(["apps/web/src/app.tsx"]);
    expect(() => sendConversationMessageInputSchema.parse({
      content: "检查文件",
      conversationId,
      referencedProjectPaths: ["../outside.ts"],
    })).toThrow();
    expect(() => sendConversationMessageInputSchema.parse({
      content: "检查文件",
      conversationId,
      referencedProjectPaths: ["README.md", "README.md"],
    })).toThrow("must be unique");
  });

  it("validates estimated conversation context usage", () => {
    expect(
      conversationContextUsageInputSchema.parse({
        conversationId: "00000000-0000-4000-8000-000000000001",
        modelId: "gpt-5.6",
        permissionMode: "ask_before_changes",
        providerId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toMatchObject({ permissionMode: "ask_before_changes" });

    expect(
      conversationContextUsageSchema.parse({
        compressionMode: "tokens",
        compressionThresholdTokens: 64_000,
        estimatedConversationTokens: 120,
        estimatedInputTokens: 260,
        estimatedSkillCatalogTokens: 10,
        estimatedSystemTokens: 40,
        estimatedTaskListTokens: 0,
        estimatedToolDefinitionTokens: 60,
        estimatedToolTokens: 40,
        historyCharacters: 480,
        includedMessageCount: 3,
        omittedMessageCount: 0,
        outputReserveTokens: 8192,
        skillReserveTokens: 20,
      }).estimatedInputTokens,
    ).toBe(260);
  });

  it("validates global context compression thresholds", () => {
    const configuration = contextCompressionConfigurationSchema.parse({
      mode: "percentage",
      percentageThreshold: 80,
      tokenThreshold: 100_000,
      version: 1,
    });

    expect(resolveContextCompressionThresholdTokens(configuration, 128_000)).toBe(102_400);
    expect(resolveContextCompressionThresholdTokens({
      ...configuration,
      mode: "tokens",
      tokenThreshold: 200_000,
    }, 128_000)).toBe(128_000);
    expect(resolveContextCompressionThresholdTokens(configuration, 0)).toBe(100_000);
    expect(() => contextCompressionConfigurationSchema.parse({
      ...configuration,
      percentageThreshold: 0,
    })).toThrow();
  });

  it("allows an optional compression threshold override for each configured model", () => {
    const contextCompression = contextCompressionThresholdSchema.parse({
      mode: "tokens",
      percentageThreshold: 80,
      tokenThreshold: 64_000,
    });

    expect(
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-responses",
        baseUrl: "https://example.test/v1",
        models: [{
          contextCompression,
          contextWindow: 128_000,
          displayName: "gpt-5.6",
          modelId: "gpt-5.6",
          reasoningOptions: [],
        }],
        providerNote: "用于日常开发",
        providerName: "测试供应商",
        providerWebsiteUrl: "https://example.test",
      }).models[0]?.contextCompression,
    ).toEqual(contextCompression);

    expect(() => contextCompressionThresholdSchema.parse({
      ...contextCompression,
      percentageThreshold: 101,
    })).toThrow();
  });

  it("validates persisted provider icon identifiers", () => {
    const configuration = {
      apiKey: "key",
      apiFormat: "openai-responses" as const,
      baseUrl: "https://example.test/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "gpt-5.6",
        modelId: "gpt-5.6",
        reasoningOptions: [],
      }],
      providerIcon: "deepseek",
      providerName: "测试供应商",
    };

    expect(saveModelConfigurationInputSchema.parse(configuration).providerIcon).toBe("deepseek");
    expect(() => saveModelConfigurationInputSchema.parse({
      ...configuration,
      providerIcon: "unlisted-provider",
    })).toThrow();
  });

  it("validates reasoning options and configured models", () => {
    expect(() =>
      sendConversationMessageInputSchema.parse({
        content: "检查项目",
        conversationId: "00000000-0000-4000-8000-000000000001",
        reasoning: { kind: "effort", value: "custom" }
      })
    ).toThrow();
    expect(
      sendConversationMessageInputSchema.parse({
        content: "检查项目",
        conversationId: "00000000-0000-4000-8000-000000000001",
        reasoning: { kind: "effort", value: "high" }
      }).reasoning
    ).toEqual({ kind: "effort", value: "high" });

    expect(() =>
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-chat-completions",
        baseUrl: "https://example.test/v1",
        defaultModelId: "gpt-5.6",
        models: [{
          contextWindow: 128000,
          displayName: "gpt-5.6",
          modelId: "gpt-5.6",
          reasoningOptions: []
        }],
        providerName: "测试供应商"
      })
    ).toThrow();

    expect(
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-responses",
        baseUrl: "https://example.test/v1",
        models: [{
          contextWindow: 128000,
          displayName: "gpt-5.6",
          modelId: "gpt-5.6",
          reasoningOptions: [
            { displayName: "无", enabled: false, kind: "effort", value: "none" },
            { kind: "effort", value: "xhigh" },
            { kind: "effort", value: "max" },
            { kind: "custom_effort", value: "provider-defined" },
          ]
        }],
        providerName: "测试供应商"
      }).models[0]?.reasoningOptions,
    ).toEqual([
      { displayName: "无", enabled: false, kind: "effort", value: "none" },
      { kind: "effort", value: "xhigh" },
      { kind: "effort", value: "max" },
      { kind: "custom_effort", value: "provider-defined" },
    ]);

    expect(() =>
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-responses",
        baseUrl: "https://example.test/v1",
        models: [{
          contextWindow: 128000,
          displayName: "兼容模型",
          modelId: "compatible-model",
          reasoningOptions: [
            { kind: "effort", value: "high" },
            { kind: "custom_effort", value: "high" },
          ]
        }],
        providerName: "测试供应商"
      })
    ).not.toThrow();

    expect(() =>
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-responses",
        baseUrl: "https://example.test/v1",
        models: [
          {
            contextWindow: 128000,
            displayName: "重复模型 1",
            modelId: "compatible-model",
            reasoningOptions: []
          },
          {
            contextWindow: 128000,
            displayName: "重复模型 2",
            modelId: "compatible-model",
            reasoningOptions: []
          }
        ],
        providerName: "测试供应商"
      })
    ).toThrow();

    expect(isReasoningOptionEnabled({ kind: "effort", value: "high" })).toBe(true);
    expect(isReasoningOptionEnabled({ enabled: false, kind: "effort", value: "high" })).toBe(false);

    expect(isReasoningOptionSupportedByApiFormat(
      "openai-chat-completions",
      { kind: "custom_effort", value: "provider-defined" },
    )).toBe(true);
    expect(isReasoningOptionSupportedByApiFormat(
      "openai-chat-completions",
      { kind: "effort", value: "max" },
      "gpt-5.6",
    )).toBe(true);
    expect(isReasoningOptionSupportedByApiFormat(
      "openai-chat-completions",
      { kind: "effort", value: "max" },
      "gpt-5.6-terra",
    )).toBe(true);
    expect(isReasoningOptionSupportedByApiFormat(
      "openai-chat-completions",
      { kind: "effort", value: "max" },
      "legacy-model",
    )).toBe(false);
    expect(isReasoningOptionSupportedByApiFormat(
      "openai-responses",
      { kind: "effort", value: "minimal" },
      "legacy-model",
    )).toBe(true);
    expect(isReasoningOptionSupportedByApiFormat(
      "openai-responses",
      { kind: "effort", value: "minimal" },
      "gpt-5.6",
    )).toBe(false);
    expect(isReasoningOptionSupportedByApiFormat(
      "anthropic-messages",
      { kind: "custom_effort", value: "provider-defined" },
    )).toBe(false);
    expect(isReasoningOptionSupportedByApiFormat(
      "google-gemini",
      { kind: "custom_effort", value: "provider-defined" },
    )).toBe(false);
    expect(isReasoningOptionSupportedByApiFormat(
      "google-gemini",
      { kind: "effort", value: "high" },
      "gemini-3.1-pro-preview",
    )).toBe(true);
    expect(isReasoningOptionSupportedByApiFormat(
      "google-gemini",
      { kind: "token_budget", value: 4_096 },
      "gemini-3.1-pro-preview",
    )).toBe(false);
    expect(isReasoningOptionSupportedByApiFormat(
      "google-gemini",
      { kind: "effort", value: "high" },
      "gemini-2.5-pro",
    )).toBe(false);

    expect(() =>
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "openai-chat-completions",
        baseUrl: "https://example.test/v1",
        models: [{
          contextWindow: 128000,
          displayName: "gpt-5.6",
          modelId: "gpt-5.6",
          reasoningOptions: [{ kind: "effort", value: "xhigh" }]
        }],
        providerName: "测试供应商"
      })
    ).not.toThrow();

    expect(() =>
      saveModelConfigurationInputSchema.parse({
        apiKey: "key",
        apiFormat: "anthropic-messages",
        baseUrl: "https://api.anthropic.com/v1",
        models: [{
          contextWindow: 200000,
          displayName: "Claude Sonnet",
          modelId: "claude-sonnet",
          reasoningOptions: [{ kind: "effort", value: "high" }]
        }],
        providerName: "Anthropic"
      })
    ).toThrow();
  });

  it("validates a global default model selection separately", () => {
    expect(
      setDefaultModelInputSchema.parse({
        modelId: "gpt-5.6",
        providerId: "00000000-0000-4000-8000-000000000001"
      })
    ).toMatchObject({ modelId: "gpt-5.6" });
  });

  it("rejects project paths that could leave the authorized root", () => {
    expect(() =>
      listProjectEntriesInputSchema.parse({
        directoryPath: "../outside",
        projectId: "00000000-0000-4000-8000-000000000001"
      })
    ).toThrow();
    expect(() =>
      listProjectEntriesInputSchema.parse({
        directoryPath: "src\\main",
        projectId: "00000000-0000-4000-8000-000000000001"
      })
    ).toThrow();
  });
});
