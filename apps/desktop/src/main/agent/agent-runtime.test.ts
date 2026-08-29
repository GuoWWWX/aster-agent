import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_AVATAR_ICONS,
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  DEFAULT_APPLICATION_SETTINGS,
} from "@agent/protocol";
import type { ConversationRunEvent, ConversationToolItem } from "@agent/protocol";

import type {
  CompleteTurnInput,
  ModelProviderAdapter,
  ModelTurnResult
} from "../model/model-contracts.js";
import { ModelRequestError } from "../model/model-request-error.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import {
  AgentDatabase,
  agentMessageModelContent,
} from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { WorkspaceTerminalTabController } from "../tools/workspace-terminal-tab-controller.js";
import {
  AgentRuntime,
  type ContextCompactionInput,
  type ContextCompactor
} from "./agent-runtime.js";
import { SkillRuntime } from "./skill-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

class FixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    this.turn += 1;
    if (this.turn === 1) {
      input.onReasoningDelta?.({
        delta: "正在检查项目目录",
        kind: "summary",
        reset: true,
      });
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        providerState: {
          apiFormat: "openai-responses",
          baseUrl: "https://api.example.com/v1",
          modelId: "test-model",
          payload: [{ id: "reasoning-1", type: "reasoning" }],
        },
        toolCalls: [
          {
            arguments: JSON.stringify({ path: "" }),
            id: "call_directory",
            name: "list_directory"
          }
        ]
      });
    }
    input.onReasoningDelta?.({
      delta: "正在整理检查结果",
      kind: "summary",
      reset: true,
    });
    input.onTextDelta("项目");
    input.onTextDelta("已确认");
    return Promise.resolve({
      content: "项目已确认",
      finishReason: "stop",
      toolCalls: []
    });
  }
}

class OpenTerminalFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ name: "构建" }),
          id: "call_open_terminal",
          name: "open_terminal",
        }],
      });
    }
    input.onTextDelta("终端已打开");
    return Promise.resolve({ content: "终端已打开", finishReason: "stop", toolCalls: [] });
  }
}

class SkillFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ skillId: "review" }),
          id: "call_load_skill",
          name: "load_skill",
        }],
      });
    }
    const activeSkillMessage = input.messages.find((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    );
    if (activeSkillMessage === undefined) {
      return Promise.reject(new Error("Active Skill instructions were not injected."));
    }
    input.onTextDelta("已按 Skill 完成审查");
    return Promise.resolve({
      content: "已按 Skill 完成审查",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class RestrictedSkillFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ skillId: "review" }),
          id: "call_restricted_skill",
          name: "load_skill",
        }],
      });
    }
    input.onTextDelta("未使用未授权 Skill");
    return Promise.resolve({
      content: "未使用未授权 Skill",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class MutatingSkillRuntime extends SkillRuntime {
  public constructor(
    private readonly entryPath: string,
    documents: SkillDocumentStore,
    integrations: IntegrationConfigurationStore,
  ) {
    super(documents, integrations);
  }

  public override execute(input: Parameters<SkillRuntime["execute"]>[0]): ReturnType<SkillRuntime["execute"]> {
    const result = super.execute(input);
    if (!result.isError) {
      writeFileSync(this.entryPath, [
        "---",
        "name: review",
        "description: Review changed code.",
        "---",
        "",
        "# Changed rules",
        "",
        "此内容已在 Run 期间变化。",
        "",
      ].join("\n"), "utf8");
    }
    return result;
  }
}

async function createRuntimeSkillFixture(root: string): Promise<{
  documents: SkillDocumentStore;
  entryPath: string;
  integrations: IntegrationConfigurationStore;
  runtime: SkillRuntime;
}> {
  const skillDirectory = path.join(root, "skills", "review");
  await mkdir(skillDirectory, { recursive: true });
  const entryPath = path.join(skillDirectory, "SKILL.md");
  await writeFile(entryPath, [
    "---",
    "name: review",
    "description: Review changed code.",
    "---",
    "",
    "# Review rules",
    "",
    "只在当前任务中使用证据。",
    "",
  ].join("\n"), "utf8");
  const integrations = new IntegrationConfigurationStore(
    path.join(root, "integration-settings.json"),
  );
  integrations.saveConfiguration({
    mcpServers: [],
    skillDirectories: [],
    skills: [{
      description: "Review changed code.",
      enabled: true,
      entryPath,
      id: "review",
      mcpDependencies: [],
      name: "review",
      scope: "user",
      version: "1.0.0",
    }],
    version: 1,
  });
  const documents = new SkillDocumentStore(
    integrations,
    path.join(root, "managed-skills"),
  );
  return {
    documents,
    entryPath,
    integrations,
    runtime: new SkillRuntime(documents, integrations),
  };
}

class FileChangeFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            arguments: JSON.stringify({ content: "export const enabled = true;\n", path: "feature.ts" }),
            id: "call_write",
            name: "write_file"
          }
        ]
      });
    }
    input.onTextDelta("文件已写入");
    return Promise.resolve({ content: "文件已写入", finishReason: "stop", toolCalls: [] });
  }
}

class OverwriteFileFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            content: "agent\n",
            overwrite: true,
            path: "target.txt",
          }),
          id: "call_overwrite",
          name: "write_file",
        }],
      });
    }
    input.onTextDelta("已处理文件变化");
    return Promise.resolve({
      content: "已处理文件变化",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class MultiChangeFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            arguments: JSON.stringify({ content: "export const first = true;\n", path: "first.ts" }),
            id: "call_write_first",
            name: "write_file",
          },
          {
            arguments: JSON.stringify({ content: "export const second = true;\n", path: "second.ts" }),
            id: "call_write_second",
            name: "write_file",
          },
        ],
      });
    }
    input.onTextDelta("两个文件已写入");
    return Promise.resolve({ content: "两个文件已写入", finishReason: "stop", toolCalls: [] });
  }
}

class ManyChangeFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public constructor(private readonly fileCount: number) {}

  public completeTurn(): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: Array.from({ length: this.fileCount }, (_, index) => ({
          arguments: JSON.stringify({
            content: `export const value${index} = ${index};\n`,
            path: `approval-${index}.ts`,
          }),
          id: `call_many_write_${index}`,
          name: "write_file",
        })),
      });
    }
    return Promise.resolve({ content: "全部文件已写入", finishReason: "stop", toolCalls: [] });
  }
}

class MultiReadFixtureModel implements ModelProviderAdapter {
  public constructor(
    private readonly paths: readonly string[] = ["one.txt", "two.txt"],
  ) {}

  public readonly requests: CompleteTurnInput[] = [];
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: this.paths.map((filePath, index) => ({
          arguments: JSON.stringify({ path: filePath }),
          id: `call_read_${index + 1}`,
          name: "read_file",
        })),
      });
    }
    input.onTextDelta("文件已读取");
    return Promise.resolve({ content: "文件已读取", finishReason: "stop", toolCalls: [] });
  }
}

class DuplicateToolCallIdFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    return Promise.resolve({
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          arguments: JSON.stringify({ path: "one.txt" }),
          id: "duplicate_call_id",
          name: "read_file",
        },
        {
          arguments: JSON.stringify({ path: "two.txt" }),
          id: "duplicate_call_id",
          name: "read_file",
        },
      ],
    });
  }
}

class ReusedToolCallIdFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    return Promise.resolve({
      content: "",
      finishReason: "tool_calls",
      toolCalls: [{
        arguments: JSON.stringify({ path: "one.txt" }),
        id: "reused_call_id",
        name: "read_file",
      }],
    });
  }
}

class UnknownToolFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: "{}",
          id: "call_unknown_tool",
          name: "missing_tool",
        }],
      });
    }
    const failure = input.messages.find((message) =>
      message.role === "tool" && message.toolCallId === "call_unknown_tool"
    );
    if (failure === undefined) throw new Error("Unknown tool failure was not returned to the model.");
    input.onTextDelta("已根据工具错误停止调用未知工具");
    return Promise.resolve({
      content: "已根据工具错误停止调用未知工具",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class MultiCommandFixtureModel implements ModelProviderAdapter {
  public constructor(
    private readonly commands: readonly string[] = ["first", "second"],
    private readonly includeParallelFlag = true,
  ) {}

  public readonly requests: CompleteTurnInput[] = [];
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: this.commands.map((command, index) => ({
          arguments: JSON.stringify({
            command,
            ...(this.includeParallelFlag ? { parallel: true } : {}),
            yieldTimeMs: 0,
          }),
          id: `call_command_${index + 1}`,
          name: "run_command",
        })),
      });
    }
    input.onTextDelta("命令已完成");
    return Promise.resolve({ content: "命令已完成", finishReason: "stop", toolCalls: [] });
  }
}

class MixedReadCommandFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            arguments: JSON.stringify({ path: "one.txt" }),
            id: "call_mixed_read_one",
            name: "read_file",
          },
          {
            arguments: JSON.stringify({ path: "two.txt" }),
            id: "call_mixed_read_two",
            name: "read_file",
          },
          {
            arguments: JSON.stringify({ command: "middle", yieldTimeMs: 0 }),
            id: "call_mixed_command",
            name: "run_command",
          },
          {
            arguments: JSON.stringify({ path: "three.txt" }),
            id: "call_mixed_read_three",
            name: "read_file",
          },
        ],
      });
    }
    input.onTextDelta("混合工具已完成");
    return Promise.resolve({ content: "混合工具已完成", finishReason: "stop", toolCalls: [] });
  }
}

class SameFileChangeFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            arguments: JSON.stringify({
              expectedReplacements: 1,
              newText: "first\n",
              oldText: "base\n",
              path: "shared.txt",
            }),
            id: "call_change_first",
            name: "replace_in_file",
          },
          {
            arguments: JSON.stringify({
              expectedReplacements: 1,
              newText: "second\n",
              oldText: "base\n",
              path: "shared.txt",
            }),
            id: "call_change_second",
            name: "replace_in_file",
          },
        ],
      });
    }
    input.onTextDelta("同文件变更已处理");
    return Promise.resolve({ content: "同文件变更已处理", finishReason: "stop", toolCalls: [] });
  }
}

class FailingFixtureModel implements ModelProviderAdapter {
  public completeTurn(): Promise<ModelTurnResult> {
    return Promise.reject(new Error("Model provider unavailable."));
  }
}

class RetryingFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (this.requests.length <= 5) {
      return Promise.reject(new ModelRequestError(429, "Model request failed (429): insufficient quota"));
    }

    input.onTextDelta("连接已恢复");
    return Promise.resolve({ content: "连接已恢复", finishReason: "stop", toolCalls: [] });
  }
}

class PartialStreamFailureFixtureModel implements ModelProviderAdapter {
  public requests = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests += 1;
    input.onTextDelta("部分回复");
    return Promise.reject(new TypeError("fetch failed"));
  }
}

class EmptyResponseFixtureModel implements ModelProviderAdapter {
  public requests = 0;

  public completeTurn(): Promise<ModelTurnResult> {
    this.requests += 1;
    return Promise.resolve({ content: "", finishReason: "stop", toolCalls: [] });
  }
}

class EmptyThenSuccessfulFixtureModel implements ModelProviderAdapter {
  public requests = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests += 1;
    if (this.requests === 1) {
      return Promise.resolve({ content: "", finishReason: "stop", toolCalls: [] });
    }
    input.onTextDelta("空响应重试成功");
    return Promise.resolve({
      content: "空响应重试成功",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class CommandFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ command: "Write-Output agent-command-ok", timeoutMs: 10_000 }),
          id: "call_command",
          name: "run_command"
        }]
      });
    }
    input.onTextDelta("命令已执行");
    return Promise.resolve({ content: "命令已执行", finishReason: "stop", toolCalls: [] });
  }
}

class RepeatingCommandFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public constructor(
    private readonly commands: readonly string[] = ["Write-Output session-command-ok"],
  ) {}

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn % 2 === 1) {
      const command = this.commands[Math.floor((this.turn - 1) / 2) % this.commands.length]
        ?? this.commands[0]
        ?? "Write-Output session-command-ok";
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ command, timeoutMs: 10_000 }),
          id: `call_session_command_${this.turn}`,
          name: "run_command",
        }],
      });
    }
    input.onTextDelta("命令已执行");
    return Promise.resolve({ content: "命令已执行", finishReason: "stop", toolCalls: [] });
  }
}

class SingleCommandFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public constructor(private readonly command: string) {}

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ command: this.command, timeoutMs: 10_000 }),
          id: `call_single_command_${this.turn}`,
          name: "run_command",
        }],
      });
    }
    input.onTextDelta("命令已执行");
    return Promise.resolve({ content: "命令已执行", finishReason: "stop", toolCalls: [] });
  }
}

class ExternalReadFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public constructor(private readonly filePath: string) {}

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ path: this.filePath }),
          id: "call_external_read",
          name: "read_external_file",
        }],
      });
    }
    input.onTextDelta("已读取外部文件");
    return Promise.resolve({ content: "已读取外部文件", finishReason: "stop", toolCalls: [] });
  }
}

function createPermissionSettingsProvider(agentId: string, rules: readonly { pattern: string; tool: "run_command" | "write_file" }[] = []) {
  let configuration = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  configuration.agentDirectory = {
    ...configuration.agentDirectory,
    agents: configuration.agentDirectory.agents.map((agent) => agent.id === agentId
      ? { ...agent, permissions: { allow: [...rules] } }
      : agent),
  };
  return {
    getConfiguration: () => configuration,
    saveConfiguration: (next: typeof configuration) => {
      configuration = next;
      return configuration;
    },
  };
}

class TaskListFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            tasks: [
              { status: "running", title: "分析需求" },
              { status: "pending", title: "完成实现" }
            ]
          }),
          id: "call_task_list_initial",
          name: "create_task_list"
        }]
      });
    }
    if (this.turn === 2) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            tasks: [
              { status: "completed", title: "分析需求" },
              { status: "running", title: "完成实现" }
            ]
          }),
          id: "call_task_list_progress",
          name: "update_task_list"
        }]
      });
    }
    if (this.turn === 3) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            tasks: [
              { status: "completed", title: "分析需求" },
              { status: "completed", title: "完成实现" }
            ]
          }),
          id: "call_task_list_completed",
          name: "update_task_list"
        }]
      });
    }
    if (this.turn === 4) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: "{}",
          id: "call_task_list_close",
          name: "close_task_list"
        }]
      });
    }
    input.onTextDelta("复杂任务已完成");
    return Promise.resolve({
      content: "复杂任务已完成",
      finishReason: "stop",
      toolCalls: []
    });
  }
}

class IncompleteTaskListFixtureModel implements ModelProviderAdapter {
  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            tasks: [
              { status: "running", title: "等待外部审批" },
              { status: "pending", title: "审批后继续" },
            ],
          }),
          id: "call_incomplete_task_list",
          name: "create_task_list",
        }],
      });
    }
    input.onTextDelta("已记录当前等待状态");
    return Promise.resolve({
      content: "已记录当前等待状态",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class ContinuousConversationFixtureModel implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    const response = this.requests.length === 1 ? "第一轮已收到" : "第二轮已收到";
    input.onTextDelta(response);
    return Promise.resolve({ content: response, finishReason: "stop", toolCalls: [] });
  }
}

class ReplaceRunningMessageFixtureModel implements ModelProviderAdapter {
  public readonly firstRequestStarted: Promise<void>;

  public readonly requests: CompleteTurnInput[] = [];

  private resolveFirstRequestStarted: () => void = () => undefined;

  public constructor() {
    this.firstRequestStarted = new Promise((resolve) => {
      this.resolveFirstRequestStarted = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      this.resolveFirstRequestStarted();
      return new Promise((_, reject) => {
        input.signal.addEventListener("abort", () => {
          reject(input.signal.reason instanceof Error
            ? input.signal.reason
            : new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    }
    input.onTextDelta("修改后的回答");
    return Promise.resolve({
      content: "修改后的回答",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class CancelledStreamFixtureModel implements ModelProviderAdapter {
  public readonly firstRequestStarted: Promise<void>;

  private resolveFirstRequestStarted: () => void = () => undefined;

  public constructor() {
    this.firstRequestStarted = new Promise((resolve) => {
      this.resolveFirstRequestStarted = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    input.onTextDelta("已经输出");
    input.onTextDelta("一半内容");
    this.resolveFirstRequestStarted();
    return new Promise((_, reject) => {
      const rejectOnAbort = (): void => reject(
        input.signal.reason instanceof Error
          ? input.signal.reason
          : new DOMException("The operation was aborted.", "AbortError")
      );
      if (input.signal.aborted) {
        rejectOnAbort();
        return;
      }
      input.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
  }
}

class ActiveAgentMessageFixtureModel implements ModelProviderAdapter {
  public readonly firstRequestStarted: Promise<void>;

  public readonly requests: CompleteTurnInput[] = [];

  private releaseFirstRequest: ((result: ModelTurnResult) => void) | null = null;

  private resolveFirstRequestStarted: () => void = () => undefined;

  public constructor() {
    this.firstRequestStarted = new Promise((resolve) => {
      this.resolveFirstRequestStarted = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      this.resolveFirstRequestStarted();
      return new Promise((resolve) => {
        this.releaseFirstRequest = resolve;
      });
    }
    input.onTextDelta("已收到协作消息");
    return Promise.resolve({
      content: "已收到协作消息",
      finishReason: "stop",
      toolCalls: [],
    });
  }

  public continueWithFinalResponse(): void {
    if (this.releaseFirstRequest === null) {
      throw new Error("The first model request has not started.");
    }
    this.releaseFirstRequest({
      content: "当前步骤已完成",
      finishReason: "stop",
      toolCalls: [],
    });
    this.releaseFirstRequest = null;
  }
}

class DeferredToolBatchFixtureModel implements ModelProviderAdapter {
  public readonly firstRequestStarted: Promise<void>;

  public readonly requests: CompleteTurnInput[] = [];

  private releaseFirstRequest: ((result: ModelTurnResult) => void) | null = null;

  private resolveFirstRequestStarted: () => void = () => undefined;

  public constructor() {
    this.firstRequestStarted = new Promise((resolve) => {
      this.resolveFirstRequestStarted = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    if (this.requests.length === 1) {
      this.resolveFirstRequestStarted();
      return new Promise((resolve) => {
        this.releaseFirstRequest = resolve;
      });
    }
    input.onTextDelta("已结合补充消息完成任务");
    return Promise.resolve({
      content: "已结合补充消息完成任务",
      finishReason: "stop",
      toolCalls: [],
    });
  }

  public continueWithToolBatch(): void {
    if (this.releaseFirstRequest === null) {
      throw new Error("The first model request has not started.");
    }
    this.releaseFirstRequest({
      content: "",
      finishReason: "tool_calls",
      toolCalls: [
        {
          arguments: JSON.stringify({ path: "" }),
          id: "call_directory_first",
          name: "list_directory",
        },
        {
          arguments: JSON.stringify({ path: "" }),
          id: "call_directory_second",
          name: "list_directory",
        },
      ],
    });
    this.releaseFirstRequest = null;
  }
}

class ReplyingAgentMessageFixtureModel implements ModelProviderAdapter {
  public senderConversationId: string | null = null;

  private turn = 0;

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.turn += 1;
    if (this.turn === 1) {
      const senderPrefix = "Sender conversationId: ";
      const senderLine = input.messages
        .flatMap((message) => message.content.split("\n"))
        .find((line) => line.startsWith(senderPrefix));
      if (senderLine === undefined) {
        throw new Error("Agent message sender was not provided to the model.");
      }
      this.senderConversationId = senderLine.slice(senderPrefix.length);
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            content: "收到，会继续处理。",
            conversationId: this.senderConversationId,
            expectReply: false,
          }),
          id: "call_reply_to_agent",
          name: "send_agent_message",
        }],
      });
    }
    input.onTextDelta("已回复原对话");
    return Promise.resolve({
      content: "已回复原对话",
      finishReason: "stop",
      toolCalls: [],
    });
  }
}

class DeferredAgentResultFixtureModel implements ModelProviderAdapter {
  public readonly recipientRequestStarted: Promise<void>;

  private messageSent = false;

  private releaseRecipientRequest: (() => void) | null = null;

  private resolveRecipientRequestStarted: () => void = () => undefined;

  public constructor(private readonly targetConversationId: string) {
    this.recipientRequestStarted = new Promise((resolve) => {
      this.resolveRecipientRequestStarted = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const isAgentResultRun = input.messages.some((message) =>
      message.role === "user"
      && message.content.includes("[Agent result]")
    );
    if (isAgentResultRun) {
      input.onTextDelta("已收到 B 的自动回传结果");
      return Promise.resolve({
        content: "已收到 B 的自动回传结果",
        finishReason: "stop",
        toolCalls: [],
      });
    }
    const isRecipientRun = input.messages.some((message) =>
      message.role === "user"
      && message.content.includes("[Agent collaboration request]")
      && message.content.includes("工具已完成，无需额外回复。")
    );
    if (isRecipientRun) {
      this.resolveRecipientRequestStarted();
      return new Promise((resolve) => {
        this.releaseRecipientRequest = () => {
          input.onTextDelta("B 最终结果");
          resolve({
            content: "B 最终结果",
            finishReason: "stop",
            toolCalls: [],
          });
        };
      });
    }
    if (!this.messageSent) {
      this.messageSent = true;
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({
            content: "工具已完成，无需额外回复。",
            conversationId: this.targetConversationId,
          }),
          id: "call_send_agent_message_only",
          name: "send_agent_message",
        }],
      });
    }
    input.onTextDelta("A 已完成初始委派");
    return Promise.resolve({ content: "A 已完成初始委派", finishReason: "stop", toolCalls: [] });
  }

  public completeRecipient(): void {
    if (this.releaseRecipientRequest === null) {
      throw new Error("The recipient request has not started.");
    }
    this.releaseRecipientRequest();
    this.releaseRecipientRequest = null;
  }
}

class SubagentLifecycleFixtureModel implements ModelProviderAdapter {
  public readonly childRequestStarted: Promise<void>;

  public readonly requests: CompleteTurnInput[] = [];

  public readonly waitRequested: Promise<void>;

  private parentTurn = 0;

  private releaseChildRequest: (() => void) | null = null;

  private resolveChildRequestStarted: () => void = () => undefined;

  private resolveWaitRequested: () => void = () => undefined;

  public constructor(
    private readonly shouldWait: boolean,
    private readonly subagentAgentId?: string,
    private readonly subagentModelSelection?: {
      modelId: string;
      providerId: string;
      reasoning?: { kind: "effort"; value: "high" };
    },
    private readonly subagentIcon: "bug" | null = "bug",
  ) {
    this.childRequestStarted = new Promise((resolve) => {
      this.resolveChildRequestStarted = resolve;
    });
    this.waitRequested = new Promise((resolve) => {
      this.resolveWaitRequested = resolve;
    });
  }

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push({ ...input, messages: [...input.messages] });
    const isSubagent = input.messages[0]?.content.includes("You are a temporary Subagent derived from parent conversation") === true;
    if (isSubagent) {
      this.resolveChildRequestStarted();
      return new Promise((resolve) => {
        this.releaseChildRequest = () => {
          input.onTextDelta("Subagent 已完成检查");
          resolve({
            content: "Subagent 已完成检查",
            finishReason: "stop",
            toolCalls: [],
          });
        };
      });
    }

    this.parentTurn += 1;
    if (this.parentTurn === 1) {
      const argumentsPayload = JSON.stringify({
        ...(this.subagentAgentId === undefined ? {} : { agentId: this.subagentAgentId }),
        ...(this.subagentModelSelection ?? {}),
        ...(this.subagentIcon === null ? {} : { icon: this.subagentIcon }),
        name: "实现检查",
        task: "检查实现并报告结果",
      });
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        providerState: {
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          payload: [{
            arguments: argumentsPayload,
            call_id: "call_spawn_subagent",
            name: "spawn_subagent",
            type: "function_call",
          }],
        },
        toolCalls: [{
          arguments: argumentsPayload,
          id: "call_spawn_subagent",
          name: "spawn_subagent",
        }],
      });
    }
    if (this.parentTurn === 2 && this.shouldWait) {
      const taskResult = input.messages.findLast((message) =>
        message.role === "tool" && message.content.includes('"childConversationId"')
      );
      const taskId = taskResult === undefined
        ? null
        : (JSON.parse(taskResult.content) as { value?: { task?: { id?: unknown } } }).value?.task?.id;
      if (typeof taskId !== "string") throw new Error("Spawned Subagent task id was not returned.");
      this.resolveWaitRequested();
      return Promise.resolve({
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{
          arguments: JSON.stringify({ taskIds: [taskId], timeoutMs: 10_000, waitFor: "all" }),
          id: "call_wait_for_subagent",
          name: "wait_for_subagents",
        }],
      });
    }
    if (this.parentTurn === 2) {
      input.onTextDelta("父任务先完成，Subagent 继续后台运行");
      return Promise.resolve({
        content: "父任务先完成，Subagent 继续后台运行",
        finishReason: "stop",
        toolCalls: [],
      });
    }

    const response = this.shouldWait ? "已等待并整合 Subagent 结果" : "已被 Subagent 结果重新激活";
    input.onTextDelta(response);
    return Promise.resolve({ content: response, finishReason: "stop", toolCalls: [] });
  }

  public completeChild(): void {
    if (this.releaseChildRequest === null) {
      throw new Error("The Subagent request has not started.");
    }
    this.releaseChildRequest();
    this.releaseChildRequest = null;
  }
}

class FixtureContextCompactor implements ContextCompactor {
  public readonly requests: ContextCompactionInput[] = [];

  public compact(input: ContextCompactionInput): Promise<string> {
    this.requests.push({ ...input, messages: [...input.messages] });
    const previousGoals = input.previousSummary === null
      ? []
      : (JSON.parse(input.previousSummary) as { goals?: string[] }).goals ?? [];
    return Promise.resolve(JSON.stringify({
      artifactRefs: [],
      commands: [],
      constraints: ["保留最近两轮原文"],
      decisions: [],
      errors: [],
      filesChanged: [],
      filesRead: [],
      goals: [
        ...previousGoals,
        `已压缩到消息 ${input.messages.at(-1)?.sequence ?? 0}`
      ],
      pendingWork: ["继续当前任务"],
      rejectedApproaches: [],
      requirements: [],
      taskStatus: [],
      testResults: []
    }));
  }
}

describe("AgentRuntime", () => {
  it("registers open_terminal for a project conversation and returns the resolved tab name", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-open-terminal-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const terminalTabs = new WorkspaceTerminalTabController();
    terminalTabs.onOpenRequested((request) => {
      terminalTabs.confirmOpened({ requestId: request.requestId, resolvedName: "构建 (1)" });
      return true;
    });
    const model = new OpenTerminalFixtureModel();
    const terminalSessions = {
      close: vi.fn(),
      open: vi.fn(() => ({
        projectId: project.id,
        sessionId: "00000000-0000-4000-8000-000000000003",
        shellLabel: "PWSH（PowerShell 7）",
      })),
      readOutput: vi.fn(() => ({ data: "", nextCursor: 0, truncated: false })),
      write: vi.fn(),
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      null,
      null,
      null,
      null,
      terminalTabs,
      terminalSessions,
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "打开构建终端",
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        if (event.type === "tool.approval_requested") {
          expect(terminalSessions.open).not.toHaveBeenCalled();
          runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });

    expect(model.requests[0]?.tools.some((tool) => tool.name === "open_terminal")).toBe(true);
    const toolMessage = model.requests[1]?.messages.find((message) => (
      message.role === "tool" && message.toolCallId === "call_open_terminal"
    ));
    expect(toolMessage?.content).toContain('"resolvedName":"构建 (1)"');
    expect(toolMessage?.content).toContain('"terminalId":"00000000-0000-4000-8000-000000000003"');
    expect(terminalSessions.open).toHaveBeenCalledOnce();
    expect(database.listTimeline(conversation.id)).toContainEqual(expect.objectContaining({
      name: "open_terminal",
      status: "completed",
    }));
    database.close();
  });

  it("writes an ordered shadow ThreadLog for a completed user Run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      {
        completeTurn: (input) => {
          input.onTextDelta("已写入日志");
          return Promise.resolve({ content: "已写入日志", finishReason: "stop", toolCalls: [] });
        },
      },
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
    );
    expect(threadLog.hasConversation(conversation.id)).toBe(false);
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        const accepted = runtime.sendMessage({
          content: "请记录这次对话",
          conversationId: conversation.id,
        }, (event) => {
          if (event.type === "run.finished") resolve(event);
        });
        if (accepted.kind !== "started") throw new Error("Expected the run to start.");
      },
    );

    await expect(finished).resolves.toMatchObject({ status: "completed" });
    expect(threadLog.hasConversation(conversation.id)).toBe(true);
    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual([
      "user_message",
      "run_created",
      "run_started",
      "assistant_message",
      "run_finished",
    ]);
    database.close();
  });

  it("uses one write-ahead run_queued event before the SQLite Run projection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-write-ahead-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      {
        completeTurn: () => Promise.resolve({ content: "已完成", finishReason: "stop", toolCalls: [] }),
      },
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
      new EventProjector(database, threadLog),
    );
    const finished = new Promise<void>((resolve) => {
      const accepted = runtime.sendMessage({
        content: "先写 JSONL",
        conversationId: conversation.id,
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
      if (accepted.kind !== "started") throw new Error("Expected the run to start.");
    });

    await finished;

    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual([
      "run_queued",
      "run_started",
      "run_terminal",
    ]);
    expect(database.listTimeline(conversation.id)).toEqual([
      expect.objectContaining({ content: "先写 JSONL", role: "user" }),
      expect.objectContaining({ content: "已完成", role: "assistant" }),
    ]);
    expect(database.listContextMessages(conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "先写 JSONL", role: "user" }),
      expect.objectContaining({ content: "已完成", role: "assistant" }),
    ]));
    database.close();
  });

  it("records one ordered execution intent before a tool result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-tool-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new FixtureModel(),
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
      new EventProjector(database, threadLog),
    );
    const finished = new Promise<void>((resolve) => {
      const accepted = runtime.sendMessage({
        content: "读取项目目录",
        conversationId: conversation.id,
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
      if (accepted.kind !== "started") throw new Error("Expected the run to start.");
    });

    await finished;

    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual([
      "run_queued",
      "run_started",
      "assistant_message",
      "tool_call_requested",
      "tool_execution_prepared",
      "tool_result",
      "run_terminal",
    ]);
    const loggedEvents = threadLog.read(conversation.id)?.events ?? [];
    expect(loggedEvents.some((event) =>
      event.type === "run_started" && event.payload.writeAhead === true,
    )).toBe(true);
    expect(loggedEvents.some((event) =>
      event.type === "assistant_message" && event.payload.writeAhead === true,
    )).toBe(true);
    database.close();
  });

  it("persists streamed Assistant content when the user cancels a run", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new CancelledStreamFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        const accepted = runtime.sendMessage({
          content: "开始输出后取消",
          conversationId: conversation.id,
        }, (event) => {
          if (event.type === "run.finished") resolve(event);
        });
        if (accepted.kind !== "started") throw new Error("Expected the run to start.");
        void model.firstRequestStarted.then(() => runtime.cancelRun(accepted.runId));
      },
    );

    await expect(finished).resolves.toMatchObject({ status: "cancelled" });
    expect(database.listTimeline(conversation.id)).toEqual([
      expect.objectContaining({ content: "开始输出后取消", role: "user" }),
      expect.objectContaining({
        content: "已经输出一半内容",
        role: "assistant",
        status: "cancelled",
      }),
    ]);
    expect(database.listModelMessages(conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "已经输出一半内容",
        role: "assistant",
      }),
    ]));
    database.close();
  });

  it("cancels a running answer before replacing the latest user message", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-replace-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new ReplaceRunningMessageFixtureModel();
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
      new EventProjector(database, threadLog),
    );
    const events: ConversationRunEvent[] = [];
    let firstRunId: string | null = null;
    let resolveReplacementFinished = (): void => undefined;
    const replacementFinished = new Promise<void>((resolve) => {
      resolveReplacementFinished = resolve;
    });
    const emit = (event: ConversationRunEvent): void => {
      events.push(event);
      if (
        event.type === "run.finished"
        && event.status === "completed"
        && event.runId !== firstRunId
      ) {
        resolveReplacementFinished();
      }
    };
    const first = runtime.sendMessage({
      content: "原始任务",
      conversationId: conversation.id,
    }, emit);
    if (first.kind !== "started") throw new Error("Expected the first run to start.");
    firstRunId = first.runId;
    await model.firstRequestStarted;

    const replacement = await runtime.replaceLatestMessage({
      content: "修改后的任务",
      conversationId: conversation.id,
      messageId: first.userMessage.id,
    }, emit);
    await replacementFinished;

    expect(events).toContainEqual(expect.objectContaining({
      runId: first.runId,
      status: "cancelled",
      type: "run.finished",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      runId: replacement.runId,
      status: "completed",
      type: "run.finished",
    }));
    expect(database.listTimeline(conversation.id)).toEqual([
      expect.objectContaining({
        content: "修改后的任务",
        id: first.userMessage.id,
        role: "user",
        runId: replacement.runId,
      }),
      expect.objectContaining({ content: "修改后的回答", role: "assistant" }),
    ]);
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "user" && message.content === "修改后的任务"
    )).toBe(true);
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "user" && message.content === "原始任务"
    )).toBe(false);
    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual([
      "run_queued",
      "run_started",
      "run_terminal",
      "run_replaced",
      "run_started",
      "run_terminal",
    ]);
    expect(threadLog.readContext(conversation.id)?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "修改后的任务", runId: replacement.runId }),
      expect.objectContaining({ content: "修改后的回答", runId: replacement.runId }),
    ]));
    expect(threadLog.readContext(conversation.id)?.messages.some((message) =>
      message.content === "原始任务"
    )).toBe(false);
    database.close();
  });

  it("emits run completion only after the final response is committed", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model: ModelProviderAdapter = {
      completeTurn(input) {
        input.onTextDelta("原子终态回复");
        return Promise.resolve({
          content: "原子终态回复",
          finishReason: "stop",
          toolCalls: [],
        });
      },
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const committedAtFinish = await new Promise<{
      assistantContent: string | undefined;
      status: string | null;
    }>((resolve) => {
      runtime.sendMessage({ content: "检查提交顺序", conversationId: conversation.id }, (event) => {
        if (event.type !== "run.finished") return;
        const assistant = database.listTimeline(conversation.id).find((item) =>
          item.kind === "message" && item.role === "assistant",
        );
        resolve({
          assistantContent: assistant?.kind === "message" ? assistant.content : undefined,
          status: database.getConversation(conversation.id).lastRunStatus,
        });
      });
    });

    expect(committedAtFinish).toEqual({
      assistantContent: "原子终态回复",
      status: "completed",
    });
    database.close();
  });

  it("persists a tool loop and emits streamed events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new FixtureModel();
    const configurationCalls: Array<[string | undefined, string | undefined]> = [];
    const connectionStatuses: Array<[string, string, "healthy" | "error"]> = [];
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: (providerId, modelId) => {
          configurationCalls.push([providerId, modelId]);
          return {
            apiKey: "secret",
            apiFormat: "openai-chat-completions",
            baseUrl: "https://example.test/v1",
            modelId: "test-model",
            reasoningOptions: [{ kind: "effort", value: "high" }]
          };
        },
        setModelConnectionStatus: (providerId, modelId, status) => {
          connectionStatuses.push([providerId, modelId, status]);
        },
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "检查项目",
          conversationId: conversation.id,
          modelId: "selected-model",
          providerId: "00000000-0000-4000-8000-000000000010",
          permissionMode: "read_only",
          reasoning: { kind: "effort", value: "high" }
        },
        (event) => {
          events.push(event);
          if (event.type === "run.finished") resolve();
        }
      );
    });
    await finished;

    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(connectionStatuses).toEqual([[
      "00000000-0000-4000-8000-000000000010",
      "selected-model",
      "healthy",
    ]]);
    expect(events.map((event) => event.type)).toContain("tool.completed");
    expect(events.filter((event) =>
      event.type === "assistant.reasoning_delta"
      || event.type === "tool.started"
      || event.type === "assistant.delta"
    ).map((event) => event.type)).toEqual([
      "assistant.reasoning_delta",
      "tool.started",
      "assistant.reasoning_delta",
      "assistant.delta",
      "assistant.delta",
    ]);
    expect(events.filter((event) => event.type === "assistant.reasoning_delta").map((event) =>
      event.delta
    )).toEqual(["正在检查项目目录", "正在整理检查结果"]);
    expect(
      events.filter((event) => event.type === "assistant.delta").map((event) => event.delta)
    ).toEqual(["项目", "已确认"]);
    expect(database.listTimeline(conversation.id).map((item) => item.kind)).toEqual([
      "message",
      "tool",
      "message"
    ]);
    expect(model.requests[1]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool"
    ]);
    expect(model.requests[1]?.messages[2]?.providerState).toEqual({
      apiFormat: "openai-responses",
      baseUrl: "https://api.example.com/v1",
      modelId: "test-model",
      payload: [{ id: "reasoning-1", type: "reasoning" }],
    });
    const tools = database
      .listTimeline(conversation.id)
      .filter((item): item is ConversationToolItem => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.batchId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(tools.map((tool) => tool.batchId)).toEqual([tools[0]?.batchId]);
    expect(model.requests[0]?.configuration.modelId).toBe("selected-model");
    expect(configurationCalls).toEqual([
      ["00000000-0000-4000-8000-000000000010", "selected-model"]
    ]);
    expect(model.requests[0]?.reasoning).toEqual({ kind: "effort", value: "high" });
    expect(model.requests[0]?.messages[0]?.content).toContain("Permission mode selected for this task: read_only.");
    expect(model.requests[0]?.messages[0]?.content).toContain("You are an independent Agent.");
    expect(model.requests[0]?.messages[0]?.content).toContain(`Current project: ${project.name}`);
    expect(model.requests[0]?.messages[0]?.content).toContain(`Authorized root: ${project.rootPath}`);
    expect(model.requests[0]?.messages[0]?.content).toContain("No Skill Runtime is currently available");
    expect(model.requests[0]?.messages[0]?.content).toContain(
      "Git is a command-line program available through run_command, not a Skill"
    );
    expect(model.requests[0]?.messages[0]?.content).toContain(
      "One model turn may return at most 32 mixed Tool Calls"
    );
    expect(model.requests[0]?.messages[0]?.content).toContain("groups of up to 8");
    expect(model.requests[0]?.messages[0]?.content).toContain("groups of up to 4");
    expect(model.requests[0]?.messages[0]?.content).toContain(
      "The application language is Simplified Chinese (zh-CN). Reply in Simplified Chinese unless the user explicitly requests another language."
    );
    expect(JSON.stringify(model.requests[0]?.tools)).not.toMatch(/\p{Script=Han}/u);
    database.close();
  });

  it("injects loaded Skill instructions into the next model turn without polluting the timeline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-"));
    temporaryDirectories.push(root);
    const { runtime: skillRuntime } = await createRuntimeSkillFixture(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new SkillFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      skillRuntime,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "按审查 Skill 检查变更", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await finished;

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("load_skill");
    expect(model.requests[0]?.messages[0]?.content).toContain("review | review");
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    )).toBe(true);
    const timeline = database.listTimeline(conversation.id);
    const persistedContent = timeline.flatMap((item) => {
      if (item.kind === "message") return [item.content];
      if (item.kind === "tool" && item.result !== null) return [item.result];
      return [];
    });
    expect(persistedContent.every((content) => !content.includes("只在当前任务中使用证据。"))).toBe(true);
    expect(persistedContent.some((content) => content.includes("contentHash"))).toBe(true);
    database.close();
  });

  it("does not unlock project-scoped Skills for a temporary conversation workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-temporary-workspace-"));
    temporaryDirectories.push(root);
    const fixture = await createRuntimeSkillFixture(root);
    const configuration = fixture.integrations.getConfiguration();
    fixture.integrations.saveConfiguration({
      ...configuration,
      skills: configuration.skills.map((skill) => ({ ...skill, scope: "project" as const })),
    });
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    await projects.mountConversationWorkspace(conversation.id, root);
    database.setConversationWorkspaceRoot(conversation.id, root);
    const model = new RestrictedSkillFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.runtime,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "临时工作目录中尝试加载项目 Skill", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await finished;

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.messages[0]?.content).not.toContain("review | review");
    const toolMessage = model.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("不适用于当前对话范围");
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    )).toBe(false);
    database.close();
  });

  it("applies a custom Agent Skill scope to both discovery and direct load attempts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-scope-"));
    temporaryDirectories.push(root);
    const { runtime: skillRuntime } = await createRuntimeSkillFixture(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null, {
      agent: {
        id: "explorer",
        instructions: "保持只读。",
        isDefault: false,
        name: "Explorer",
        role: "搜索与事实核对",
      },
    });
    const model = new RestrictedSkillFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      { getConfiguration: () => DEFAULT_AGENT_DIRECTORY_CONFIGURATION },
      skillRuntime,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "尝试加载未授权 Skill", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await finished;

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.messages[0]?.content).not.toContain("review | review");
    const toolMessage = model.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("未被当前 Agent 授权");
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    )).toBe(false);
    database.close();
  });

  it("fails closed when a bound Agent has no directory provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-no-directory-"));
    temporaryDirectories.push(root);
    const { runtime: skillRuntime } = await createRuntimeSkillFixture(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null, {
      agent: {
        id: "explorer",
        instructions: "保持只读。",
        isDefault: false,
        name: "Explorer",
        role: "搜索与事实核对",
      },
    });
    const model = new RestrictedSkillFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      skillRuntime,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "尝试加载未授权 Skill", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await finished;

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.messages[0]?.content).not.toContain("review | review");
    const toolMessage = model.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("未被当前 Agent 授权");
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    )).toBe(false);
    database.close();
  });

  it("does not allow Skills for a disabled bound Agent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-disabled-agent-"));
    temporaryDirectories.push(root);
    const fixture = await createRuntimeSkillFixture(root);
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    const disabledAgent = directory.agents.find((agent) => agent.id === "explorer");
    if (disabledAgent === undefined) throw new Error("Explorer fixture is missing.");
    disabledAgent.enabled = false;
    disabledAgent.skillIds = ["review"];
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null, {
      agent: {
        id: disabledAgent.id,
        instructions: disabledAgent.instructions,
        isDefault: disabledAgent.isDefault,
        name: disabledAgent.name,
        role: disabledAgent.role,
      },
    });
    const model = new RestrictedSkillFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      { getConfiguration: () => directory },
      fixture.runtime,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "尝试使用已禁用 Agent 的 Skill", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await finished;

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.messages[0]?.content).not.toContain("review | review");
    const toolMessage = model.requests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("未被当前 Agent 授权");
    expect(model.requests[1]?.messages.some((message) =>
      message.role === "system" && message.content.includes("只在当前任务中使用证据。"),
    )).toBe(false);
    database.close();
  });

  it("fails a Skill-backed Run when the loaded document changes before the next graph turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-skill-change-"));
    temporaryDirectories.push(root);
    const fixture = await createRuntimeSkillFixture(root);
    const skillRuntime = new MutatingSkillRuntime(
      fixture.entryPath,
      fixture.documents,
      fixture.integrations,
    );
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model: ModelProviderAdapter = {
      completeTurn() {
        return Promise.resolve({
          content: "",
          finishReason: "tool_calls",
          toolCalls: [{
            arguments: JSON.stringify({ skillId: "review" }),
            id: "call_load_skill_change",
            name: "load_skill",
          }],
        });
      },
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      skillRuntime,
    );
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>((resolve) => {
      runtime.sendMessage(
        { content: "加载 Skill 后继续", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve(event);
        },
      );
    });

    await expect(finished).resolves.toMatchObject({ status: "failed" });
    const lastMessage = database.listTimeline(conversation.id).findLast((item) => item.kind === "message");
    expect(lastMessage?.kind === "message" ? lastMessage.content : "")
      .toContain("无法静默恢复旧 Run");
    database.close();
  });

  it("keeps project file tools unavailable while allowing temporary commands and planning", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const requests: CompleteTurnInput[] = [];
    const model: ModelProviderAdapter = {
      completeTurn(input) {
        requests.push({ ...input, messages: [...input.messages] });
        input.onTextDelta("已完成");
        return Promise.resolve({
          content: "已完成",
          finishReason: "stop",
          toolCalls: []
        });
      }
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "gpt-5.6",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "临时问题", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });

    await finished;

    expect(requests[0]?.tools.map((tool) => tool.name)).toEqual([
      "close_task_list",
      "create_task_list",
      "list_agent_conversations",
      "list_models",
      "list_subagents",
      "read_agent_conversation",
      "read_external_file",
      "run_command",
      "send_agent_message",
      "spawn_subagent",
      "stop_command",
      "update_task_list",
      "wait_for_agent_message",
      "wait_for_commands",
      "wait_for_subagents",
      "web_search"
    ]);
    expect(requests[0]?.reasoning).toBeUndefined();
    expect(requests[0]?.messages[0]?.content).toContain("You are an independent Agent.");
    expect(requests[0]?.messages[0]?.content).toContain("This temporary conversation has no workspace.");
    database.close();
  });

  it("runs a side fork from its inherited checkpoint without presenting it as a Subagent", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const parent = database.createConversation(null);
    database.bindConversationAgent(parent.id, {
      id: "reviewer",
      instructions: "延续父对话的审查标准。",
      isDefault: false,
      name: "Reviewer",
      role: "代码审查",
    });
    const parentRun = database.createRunWithUserMessage(
      parent.id,
      "需要由摘要继承的旧消息",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "需要由摘要继承的旧回复",
      conversationId: parent.id,
      messageId: "00000000-0000-4000-8000-000000000203",
      modelId: "test-model",
      runId: parentRun.runId,
      toolCalls: []
    });
    database.finishRun(parentRun.runId, "completed", null);
    const coveredThroughSequence = database.listContextMessages(parent.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected parent context messages.");
    database.saveContextCheckpoint(
      parent.id,
      coveredThroughSequence,
      JSON.stringify({ goals: ["从最新压缩摘要继续"] })
    );
    const recentRun = database.createRunWithUserMessage(
      parent.id,
      "压缩之后仍需继承",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "压缩后的最新回复",
      conversationId: parent.id,
      messageId: "00000000-0000-4000-8000-000000000204",
      modelId: "test-model",
      runId: recentRun.runId,
      toolCalls: []
    });
    database.finishRun(recentRun.runId, "completed", null);
    const sideConversation = database.forkConversation(parent.id, "side");
    const requests: CompleteTurnInput[] = [];
    const model: ModelProviderAdapter = {
      completeTurn(input) {
        requests.push({ ...input, messages: [...input.messages] });
        input.onTextDelta("侧边回复");
        return Promise.resolve({ content: "侧边回复", finishReason: "stop", toolCalls: [] });
      }
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "继续侧边分支", conversationId: sideConversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });

    await finished;

    const request = requests[0];
    expect(request?.messages[0]?.content).toContain("You are a side branch created from parent conversation");
    expect(request?.messages[0]?.content).toContain("Its context snapshot is already injected");
    expect(request?.messages[0]?.content).toContain("Current Agent: Reviewer");
    expect(request?.messages[0]?.content).toContain("延续父对话的审查标准");
    expect(request?.messages[0]?.content).not.toContain("临时 Subagent");
    expect(request?.messages.some((message) =>
      message.content.includes("从最新压缩摘要继续")
    )).toBe(true);
    expect(request?.messages.some((message) =>
      message.content === "压缩之后仍需继承"
    )).toBe(true);
    expect(request?.messages.some((message) =>
      message.content === "需要由摘要继承的旧消息"
    )).toBe(false);
    expect(database.listTimeline(sideConversation.id).filter(
      (item) => item.kind === "message"
    ).map((item) => item.content)).toEqual(["继续侧边分支", "侧边回复"]);
    database.close();
  });

  it("injects persisted Team Lead, Agent, and Subagent identities into one runtime path", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const leadAgent = {
      id: "team-lead",
      instructions: "只在任务确实可并行时委派。",
      isDefault: false,
      name: "Team Lead",
      role: "接单、调度与汇总",
    };
    const workerAgent = {
      id: "explorer",
      instructions: "保持只读并返回准确文件位置。",
      isDefault: false,
      name: "Explorer",
      role: "搜索与事实核对",
    };
    const lead = database.createConversation(null, {
      agent: leadAgent,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    const worker = database.createConversation(null, {
      agent: workerAgent,
      teamId: "default-team",
      threadKind: "agent",
    });
    const subagent = database.forkConversation(lead.id);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const sendAndWait = (
      conversationId: string,
      agent?: typeof workerAgent,
    ): Promise<void> => new Promise((resolve) => {
      runtime.sendMessage({
        ...(agent === undefined ? {} : { agent }),
        content: "处理当前任务",
        conversationId,
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    await sendAndWait(lead.id);
    await sendAndWait(worker.id);
    await sendAndWait(subagent.id, workerAgent);

    expect(model.requests[0]?.messages[0]?.content).toContain(
      "You are the Team Lead for team default-team",
    );
    expect(model.requests[0]?.messages[0]?.content).toContain(leadAgent.instructions);
    expect(model.requests[1]?.messages[0]?.content).toContain(
      "You are a standing Agent in team default-team",
    );
    expect(model.requests[2]?.messages[0]?.content).toContain(
      `temporary Subagent derived from parent conversation ${lead.id}`,
    );
    expect(database.getConversation(subagent.id)).toMatchObject({
      agentId: "explorer",
      parentConversationId: lead.id,
      threadKind: "subagent",
    });
    database.close();
  });

  it("uses durable team members through Agent messages instead of Subagents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-team-members-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const configuredLead = directory.agents.find((agent) => agent.id === "team-lead");
    const explorer = directory.agents.find((agent) => agent.id === "explorer");
    if (configuredLead === undefined || explorer === undefined) {
      throw new Error("Team fixture is missing.");
    }
    const lead = database.createConversation(project.id, {
      agent: {
        avatarIcon: "sparkles",
        id: configuredLead.id,
        instructions: configuredLead.instructions,
        isDefault: configuredLead.isDefault,
        name: configuredLead.name,
        role: configuredLead.role,
      },
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.bindTeamExecutionConversation({
      conversationId: lead.id,
      projectId: project.id,
      sourceConversationId: null,
      teamId: "default-team",
    });
    const member = database.createConversation(project.id, {
      agent: {
        avatarIcon: "compass",
        id: explorer.id,
        instructions: explorer.instructions,
        isDefault: explorer.isDefault,
        name: explorer.name,
        role: explorer.role,
      },
      parentConversationId: lead.id,
      teamId: "default-team",
      threadKind: "agent",
    });
    database.bindTeamMemberConversation({
      agentId: explorer.id,
      conversationId: member.id,
      teamExecutionConversationId: lead.id,
    });
    const model = new FixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      null,
      null,
      { getConfiguration: () => directory },
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "请协调成员", conversationId: lead.id }, (event) => {
        if (event.type === "run.finished" && event.conversationId === lead.id) resolve();
      });
    });

    const request = model.requests[0];
    expect(request?.messages[0]?.content).toContain("persistent Agent Team");
    expect(request?.messages[0]?.content).toContain(member.id);
    expect(request?.tools.map((tool) => tool.name)).toContain("send_agent_message");
    expect(request?.tools.map((tool) => tool.name)).not.toContain("spawn_subagent");
    expect(request?.tools.map((tool) => tool.name)).not.toContain("wait_for_subagents");
    expect(database.listSubagentTasks(lead.id)).toEqual([]);
    expect(database.listTeamMemberConversations(lead.id).map((conversation) => conversation.id)).toEqual([member.id]);
    database.close();
  });

  it("uses a temporary conversation workspace without asking the model for its root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-workspace-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    await projects.mountConversationWorkspace(conversation.id, root);
    database.setConversationWorkspaceRoot(conversation.id, root);
    const model = new FixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "查看工作目录", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });

    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("list_directory");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("find_files");
    expect(model.requests[0]?.tools.map((tool) => tool.name)).not.toContain("get_project_info");
    expect(model.requests[0]?.messages[0]?.content).toContain(`Authorized root: ${path.resolve(await realpath(root))}`);
    expect(model.requests[0]?.messages[0]?.content).toContain("Do not call a tool merely to discover the authorized root");
    database.close();
  });

  it("records an actionable failure instead of completing an empty model response", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new EmptyResponseFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      () => Promise.resolve(),
    );
    const statuses: string[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "你好", conversationId: conversation.id },
        (event) => {
          if (event.type !== "run.finished") return;
          statuses.push(event.status);
          resolve();
        }
      );
    });

    expect(statuses).toEqual(["failed"]);
    const emptyResponseTimeline = database.listTimeline(conversation.id);
    expect(emptyResponseTimeline).toMatchObject([
      { content: "你好", role: "user", status: "completed" },
      {
        role: "assistant",
        status: "failed"
      }
    ]);
    const emptyResponseFailure = emptyResponseTimeline[1];
    if (emptyResponseFailure?.kind !== "message") {
      throw new Error("Expected an assistant failure message.");
    }
    expect(emptyResponseFailure.content).toContain(
      "模型未返回可显示内容，请稍后重试或切换模型。",
    );
    expect(model.requests).toBe(6);
    database.close();
  });

  it("removes incomplete legacy tool calls from the model context", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const legacy = database.createRunWithUserMessage(
      conversation.id,
      "旧任务",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "旧任务已分析。",
      conversationId: conversation.id,
      messageId: "00000000-0000-4000-8000-000000000001",
      modelId: "test-model",
      runId: legacy.runId,
      toolCalls: [{ arguments: "{}", id: "legacy_call", name: " " }]
    });
    database.finishRun(legacy.runId, "failed", "legacy tool call was incomplete");
    const emptyLegacy = database.createRunWithUserMessage(
      conversation.id,
      "旧空回复",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "",
      conversationId: conversation.id,
      messageId: "00000000-0000-4000-8000-000000000002",
      modelId: "test-model",
      runId: emptyLegacy.runId,
      toolCalls: []
    });
    database.finishRun(emptyLegacy.runId, "completed", null);

    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "继续任务", conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });

    const context = model.requests[0]?.messages ?? [];
    expect(context).toContainEqual(expect.objectContaining({
      content: "旧任务已分析。",
      role: "assistant",
      toolCalls: []
    }));
    expect(context).not.toContainEqual(expect.objectContaining({
      content: "",
      role: "assistant"
    }));
    expect(context.every((message) => message.toolCalls.every(
      (toolCall) => toolCall.id.trim().length > 0 && toolCall.name.trim().length > 0
    ))).toBe(true);
    database.close();
  });

  it("persists task-list progress and removes the list when the model closes it", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new TaskListFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );
    const taskUpdates: Array<{ status: string; taskStatuses: string[] } | null> = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: "完成一个复杂任务", conversationId: conversation.id },
        (event) => {
          if (event.type === "task_list.updated") {
            taskUpdates.push(event.taskList === null ? null : {
              status: event.taskList.status,
              taskStatuses: event.taskList.tasks.map((task) => task.status)
            });
          }
          if (event.type === "run.finished") resolve();
        }
      );
    });

    expect(taskUpdates).toEqual([
      { status: "active", taskStatuses: ["running", "pending"] },
      { status: "active", taskStatuses: ["completed", "running"] },
      { status: "active", taskStatuses: ["completed", "completed"] },
      null
    ]);
    expect(database.getTaskList(conversation.id)).toBeNull();
    const taskContext = (requestIndex: number): string[] => (model.requests[requestIndex]?.messages ?? [])
      .filter((message) => message.content.includes("[Current task list | live state]"))
      .map((message) => message.content);
    // Task state is loaded before every model call, rather than being frozen
    // into the first system prompt or accumulated in graph message state.
    expect(taskContext(0)).toEqual([]);
    expect(taskContext(1)).toEqual([expect.stringContaining("1. [running] 分析需求")]);
    expect(taskContext(1)[0]).toContain("2. [pending] 完成实现");
    expect(taskContext(2)).toEqual([expect.stringContaining("1. [completed] 分析需求")]);
    expect(taskContext(2)[0]).toContain("2. [running] 完成实现");
    expect(taskContext(3)).toEqual([expect.stringContaining("2. [completed] 完成实现")]);
    expect(taskContext(4)).toEqual([]);
    database.close();
  });

  it("does not mark a running task completed merely because its Run finished", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new IncompleteTaskListFixtureModel(),
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "等待审批后继续", conversationId: conversation.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    expect(database.getTaskList(conversation.id)?.tasks.map((task) => task.status))
      .toEqual(["running", "pending"]);
    database.close();
  });

  it("retains completed assistant context across consecutive conversation messages", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model
    );

    const sendAndWait = (content: string): Promise<void> => new Promise((resolve) => {
      runtime.sendMessage({ content, conversationId: conversation.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    await sendAndWait("第一轮问题");
    await sendAndWait("第二轮问题");

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(model.requests[1]?.messages[2]?.content).toBe("第一轮已收到");
    expect(database.listTimeline(conversation.id)).toMatchObject([
      { content: "第一轮问题", role: "user" },
      { content: "第一轮已收到", role: "assistant" },
      { content: "第二轮问题", role: "user" },
      { content: "第二轮已收到", role: "assistant" }
    ]);
    database.close();
  });

  it("injects referenced project paths without changing the user timeline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-files-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "feature.ts"), "export const enabled = true;\n");
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const baseUsage = runtime.getContextUsage({
      conversationId: conversation.id,
      permissionMode: "read_only",
    });
    const referencedUsage = runtime.getContextUsage({
      conversationId: conversation.id,
      permissionMode: "read_only",
      referencedProjectPaths: ["src/feature.ts"],
    });

    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "/review 检查这个文件",
        conversationId: conversation.id,
        referencedProjectPaths: ["src/feature.ts"],
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    const requestMessages = model.requests[0]?.messages ?? [];
    expect(requestMessages.at(-1)?.content).toContain("[Referenced project files]");
    expect(requestMessages.at(-1)?.content).toContain("src/feature.ts");
    expect(requestMessages.at(-1)?.content).toContain("read_file");
    expect(requestMessages[0]?.content).toContain("`/review` means review the relevant implementation");
    expect(referencedUsage.estimatedReferenceTokens).toBeGreaterThan(
      baseUsage.estimatedReferenceTokens,
    );
    expect(database.listTimeline(conversation.id)[0]).toMatchObject({
      content: "/review 检查这个文件",
      role: "user",
    });
    database.close();
  });

  it("injects a bounded referenced conversation without changing the user timeline", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const compressedRun = database.createRunWithUserMessage(
      source.id,
      "压缩前问题",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "压缩前回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: compressedRun.runId,
      toolCalls: [],
    });
    database.finishRun(compressedRun.runId, "completed", null);
    database.renameConversation(source.id, "来源对话");
    const coveredThroughSequence = database.listContextMessages(source.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected source messages.");
    database.saveContextCheckpoint(source.id, coveredThroughSequence, "来源对话压缩摘要");
    const recentRun = database.createRunWithUserMessage(source.id, "压缩后问题", "test-model");
    database.appendAssistantTurn({
      content: "压缩后回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: recentRun.runId,
      toolCalls: [],
    });
    database.finishRun(recentRun.runId, "completed", null);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "结合引用给我结论",
        conversationId: current.id,
        referencedConversationIds: [source.id],
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    const modelContent = model.requests[0]?.messages.at(-1)?.content ?? "";
    expect(modelContent).toContain("结合引用给我结论");
    expect(modelContent).toContain("来源对话压缩摘要");
    expect(modelContent).toContain("压缩后问题");
    expect(modelContent).not.toContain("压缩前问题");
    expect(database.listTimeline(current.id)[0]).toMatchObject({
      content: "结合引用给我结论",
      role: "user",
    });
    database.close();
  });

  it("delivers a new Agent message before the active conversation's next model turn", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const sender = database.createConversation(null);
    database.renameConversation(sender.id, "协作 Agent");
    const target = database.createConversation(null);
    const model = new ActiveAgentMessageFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const completedConversations = new Set<string>();
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "开始处理", conversationId: target.id }, (event) => {
        if (event.type !== "run.finished") return;
        completedConversations.add(event.conversationId);
        if (completedConversations.has(sender.id) && completedConversations.has(target.id)) {
          resolve();
        }
      });
    });
    await model.firstRequestStarted;
    const message = database.sendAgentMessage({
      content: "我已完成依赖修改",
      runId: crypto.randomUUID(),
      senderConversationId: sender.id,
      targetConversationId: target.id,
    });
    model.continueWithFinalResponse();
    await finished;

    expect(model.requests).toHaveLength(3);
    expect(model.requests[1]?.messages).toContainEqual(
      expect.objectContaining({
        content: agentMessageModelContent(message),
        role: "user",
      }),
    );
    const deliveredMessage = model.requests[1]?.messages.find((candidate) =>
      candidate.content.includes("[Agent collaboration request]"),
    );
    expect(model.requests[1]?.messages.filter((candidate) =>
      candidate.content === agentMessageModelContent(message),
    )).toHaveLength(1);
    expect(deliveredMessage?.content).toContain("Sender conversation: 协作 Agent");
    expect(deliveredMessage?.content).toContain(`Sender conversationId: ${sender.id}`);
    expect(deliveredMessage?.content).toContain(
      "runtime automatically links that final result back to the sender",
    );
    expect(model.requests[1]?.messages[0]?.content).toContain(
      "runtime links final results back to the sender",
    );
    expect(database.listUnreadAgentMessages(target.id)).toEqual([]);
    expect(database.listTimeline(sender.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "已收到协作消息",
        kind: "agent_message",
        messageType: "agent_result",
        senderConversationId: target.id,
      }),
      expect.objectContaining({
        content: "已收到协作消息",
        kind: "message",
        role: "assistant",
        status: "completed",
      }),
    ]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    database.close();
  });

  it("does not duplicate an unread Agent message already present in a new Run context", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    const message = database.sendAgentMessage({
      content: "在新 Run 开始前已送达的协作消息",
      runId: crypto.randomUUID(),
      senderConversationId: sender.id,
      targetConversationId: target.id,
    });
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "继续处理", conversationId: target.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    expect(model.requests[0]?.messages.filter((candidate) =>
      candidate.content === agentMessageModelContent(message),
    )).toHaveLength(1);
    expect(database.listUnreadAgentMessages(target.id)).toEqual([]);
  });

  it("consumes queued messages in the reordered sequence and keeps edits in place", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-pending-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const model = new ActiveAgentMessageFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
      new EventProjector(database, threadLog),
    );
    let finishedRuns = 0;
    let resolveAllFinished: (() => void) | null = null;
    const allFinished = new Promise<void>((resolve) => {
      resolveAllFinished = resolve;
    });
    const emit = (event: ConversationRunEvent): void => {
      if (event.type !== "run.finished") return;
      finishedRuns += 1;
      if (finishedRuns === 3) resolveAllFinished?.();
    };
    runtime.sendMessage({ content: "当前正在处理", conversationId: conversation.id }, emit);
    await model.firstRequestStarted;
    const second = runtime.sendMessage({
      content: "原第二条",
      conversationId: conversation.id,
    }, emit);
    const third = runtime.sendMessage({
      content: "第三条调整到前面",
      conversationId: conversation.id,
    }, emit);
    if (second.kind !== "pending" || third.kind !== "pending") {
      throw new Error("Messages sent during a run were not queued.");
    }
    runtime.reorderPendingMessages(
      conversation.id,
      [third.pendingMessage.id, second.pendingMessage.id],
      emit,
    );
    runtime.updatePendingMessage(second.pendingMessage.id, "第二条编辑后", emit);
    model.continueWithFinalResponse();

    await allFinished;

    expect(model.requests).toHaveLength(3);
    expect(model.requests[1]?.messages.filter((message) => message.role === "user").at(-1)?.content)
      .toBe("第三条调整到前面");
    expect(model.requests[2]?.messages.filter((message) => message.role === "user").at(-1)?.content)
      .toBe("第二条编辑后");
    expect(database.listPendingMessages(conversation.id)).toEqual([]);
    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "pending_messages_updated",
        "run_queued",
      ]),
    );
    expect(threadLog.read(conversation.id)?.events.some((event) =>
      event.type === "pending_messages_updated" && event.payload.writeAhead === true,
    )).toBe(true);
    expect(threadLog.readContext(conversation.id)?.messages.filter((message) =>
      message.role === "user"
    ).map((message) => message.content)).toEqual(expect.arrayContaining([
      "当前正在处理",
      "第三条调整到前面",
      "第二条编辑后",
    ]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    database.close();
  });

  it("resumes persisted pending messages after reopening the application database", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-pending-resume-"));
    temporaryDirectories.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    const pending = database.enqueuePendingMessage({
      content: "应用重启后继续发送",
      conversationId: conversation.id,
    });
    database.close();

    const reopened = new AgentDatabase(databasePath);
    const projects = new ProjectRegistry(reopened);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      reopened,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.resumePendingMessages((event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    await finished;

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.messages.filter((message) => message.role === "user").at(-1)?.content)
      .toBe("应用重启后继续发送");
    expect(reopened.listPendingMessages(conversation.id)).toEqual([]);
    const resumedUserMessage = reopened.listTimeline(conversation.id).find((item) =>
      item.kind === "message" && item.role === "user"
    );
    expect(resumedUserMessage).toMatchObject({ content: "应用重启后继续发送" });
    expect(resumedUserMessage?.id).not.toBe(pending.id);
    reopened.close();
  });

  it("resumes a queued Run after restart without creating a duplicate user message", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-run-resume-"));
    temporaryDirectories.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    const executionSnapshot = {
      apiFormat: "openai-chat-completions" as const,
      baseUrl: "https://example.test/v1",
      contextCompressionConfiguration: {
        mode: "percentage" as const,
        percentageThreshold: 80,
        tokenThreshold: 100_000,
      },
      contextWindow: null,
      modelId: "test-model",
      permissionMode: "ask_before_changes" as const,
      plugins: [],
      providerId: null,
      reasoning: null,
      reasoningOptions: [],
      toolManifest: [],
    };
    const creation = database.createRunWithUserMessage(
      conversation.id,
      "恢复尚未开始的 Run",
      "test-model",
      [],
      "恢复尚未开始的 Run",
      executionSnapshot,
    );
    database.close();

    const reopened = new AgentDatabase(databasePath);
    const projects = new ProjectRegistry(reopened);
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      reopened,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.resumePendingMessages((event) => {
        if (event.type === "run.finished" && event.runId === creation.runId) resolve();
      });
    });

    await finished;

    expect(model.requests).toHaveLength(1);
    expect(reopened.listTimeline(conversation.id).filter((item) =>
      item.kind === "message" && item.role === "user",
    )).toHaveLength(1);
    expect(reopened.getConversation(conversation.id).lastRunStatus).toBe("completed");
    reopened.close();
  });

  it("fails queued recovery when the frozen Tool Manifest no longer matches", () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const creation = database.createRunWithUserMessage(
      conversation.id,
      "恢复时不要替换可调用工具",
      "test-model",
      [],
      "恢复时不要替换可调用工具",
      {
        apiFormat: "openai-chat-completions",
        baseUrl: "https://example.test/v1",
        contextCompressionConfiguration: {
          mode: "percentage",
          percentageThreshold: 80,
          tokenThreshold: 100_000,
        },
        contextWindow: null,
        modelId: "test-model",
        permissionMode: "ask_before_changes",
        plugins: [],
        providerId: null,
        reasoning: null,
        reasoningOptions: [],
        toolManifest: [{
          contentHash: "f".repeat(64),
          name: "removed_tool",
        }],
      },
    );
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );

    runtime.resumePendingMessages(() => undefined);

    expect(model.requests).toHaveLength(0);
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: null,
      lastRunStatus: "failed",
    });
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "message")).toHaveLength(1);
    expect(creation.runId).toEqual(expect.any(String));
    database.close();
  });

  it("injects steer messages only after every tool result in the active batch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-steer-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new DeferredToolBatchFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "先检查项目", conversationId: conversation.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });
    await model.firstRequestStarted;
    const steered = runtime.sendMessage({
      content: "补充：两个目录读取完成后再考虑这个要求",
      conversationId: conversation.id,
      deliveryMode: "steer",
    }, () => undefined);
    expect(steered).toMatchObject({
      kind: "pending",
      pendingMessage: { deliveryMode: "steer" },
    });
    model.continueWithToolBatch();
    await finished;

    expect(model.requests).toHaveLength(2);
    const messages = model.requests[1]?.messages ?? [];
    const assistantToolCallIndex = messages.findIndex((message) =>
      message.role === "assistant" && message.toolCalls.length === 2
    );
    const toolResultIndexes = messages.flatMap((message, index) =>
      message.role === "tool" ? [index] : []
    );
    const steerIndex = messages.findIndex((message) =>
      message.role === "user" && message.content.includes("两个目录读取完成后")
    );
    expect(assistantToolCallIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndexes).toHaveLength(2);
    expect(toolResultIndexes.every((index) => index > assistantToolCallIndex)).toBe(true);
    expect(steerIndex).toBeGreaterThan(toolResultIndexes.at(-1) ?? Number.MAX_SAFE_INTEGER);
    expect(messages.slice(assistantToolCallIndex + 1, steerIndex).some(
      (message) => message.role === "user"
    )).toBe(false);
    expect(database.listPendingMessages(conversation.id)).toEqual([]);
    database.close();
  });

  it("routes an Agent reply back to the message sender conversation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-thread-log-agent-message-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const sender = database.createConversation(null);
    database.renameConversation(sender.id, "负责人");
    const target = database.createConversation(null);
    database.renameConversation(target.id, "执行 Agent");
    database.sendAgentMessage({
      content: "处理完成后回复我。",
      runId: crypto.randomUUID(),
      senderConversationId: sender.id,
      targetConversationId: target.id,
    });
    const model = new ReplyingAgentMessageFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      threadLog,
    );
    const completedConversations = new Set<string>();
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "开始处理", conversationId: target.id }, (event) => {
        if (event.type !== "run.finished") return;
        completedConversations.add(event.conversationId);
        if (completedConversations.has(sender.id) && completedConversations.has(target.id)) {
          resolve();
        }
      });
    });

    expect(model.senderConversationId).toBe(sender.id);
    const replyingConversation = database.getConversation(target.id);
    expect(database.listUnreadAgentMessages(sender.id)).toEqual([]);
    expect(database.listTimeline(sender.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "收到，会继续处理。",
        kind: "agent_message",
        senderConversationId: target.id,
        senderTitle: replyingConversation.title,
      }),
      expect.objectContaining({
        content: "已回复原对话",
        kind: "message",
        role: "assistant",
        status: "completed",
      }),
    ]));
    const agentMessageEvents = threadLog.read(sender.id)?.events.filter(
      (event) => event.type === "agent_message",
    ) ?? [];
    expect(new Set(agentMessageEvents.map((event) => {
      const messageId = event.payload.messageId;
      return typeof messageId === "string" ? messageId : "";
    }))).toHaveLength(
      agentMessageEvents.length,
    );
    expect(agentMessageEvents.filter((event) =>
      String(event.payload.content).includes("收到，会继续处理。"),
    )).toHaveLength(1);
    expect(threadLog.readContext(sender.id)?.messages.some((message) =>
      message.role === "user" && message.content.includes("收到，会继续处理。"),
    )).toBe(true);
    database.close();
  });

  it("returns a completed Agent result and reactivates its finished sender", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    const model = new DeferredAgentResultFixtureModel(target.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const statuses = new Map<string, string>();
    let senderFinished = 0;
    let targetFinished = 0;
    let resolveInitialSender: () => void = () => undefined;
    let resolveAllFinished: () => void = () => undefined;
    const initialSenderFinished = new Promise<void>((resolve) => {
      resolveInitialSender = resolve;
    });
    const allFinished = new Promise<void>((resolve) => {
      resolveAllFinished = resolve;
    });

    runtime.sendMessage({ content: "通知执行 Agent", conversationId: sender.id }, (event) => {
      if (event.type !== "run.finished") return;
      statuses.set(event.conversationId, event.status);
      if (event.conversationId === sender.id) {
        senderFinished += 1;
        if (senderFinished === 1) resolveInitialSender();
      } else if (event.conversationId === target.id) {
        targetFinished += 1;
      }
      if (senderFinished === 2 && targetFinished === 1) resolveAllFinished();
    });

    await Promise.all([initialSenderFinished, model.recipientRequestStarted]);
    expect(database.getConversation(sender.id).activeRunId).toBeNull();
    expect(database.getConversation(target.id).activeRunId).not.toBeNull();
    model.completeRecipient();
    await allFinished;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(statuses).toEqual(new Map([
      [sender.id, "completed"],
      [target.id, "completed"],
    ]));
    expect(database.listUnreadAgentMessages(target.id)).toEqual([]);
    expect(database.listTimeline(target.id)).toEqual([
      expect.objectContaining({
        content: "工具已完成，无需额外回复。",
        kind: "agent_message",
        senderConversationId: sender.id,
      }),
      expect.objectContaining({
        content: "B 最终结果",
        kind: "message",
        role: "assistant",
        status: "completed",
      }),
    ]);
    const timeline = database.listTimeline(sender.id);
    expect(timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "B 最终结果",
        kind: "agent_message",
        messageType: "agent_result",
        senderConversationId: target.id,
      }),
      expect.objectContaining({
        content: "已收到 B 的自动回传结果",
        kind: "message",
        role: "assistant",
        status: "completed",
      }),
    ]));
    expect(timeline.some((item) => item.kind === "message" && item.status === "failed")).toBe(false);
    database.close();
  });

  it("waits for a Subagent only when the parent explicitly requests its result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-subagent-thread-log-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const parent = database.createConversation(null);
    const providerId = crypto.randomUUID();
    const model = new SubagentLifecycleFixtureModel(true, undefined, {
      modelId: "alternate-model",
      providerId,
      reasoning: { kind: "effort", value: "high" },
    });
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: (_selectedProviderId, selectedModelId) => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: selectedModelId ?? "test-model",
          reasoningOptions: selectedModelId === "alternate-model"
            ? [{ kind: "effort", value: "high" }]
            : [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      threadLog,
    );
    const completedConversations = new Set<string>();
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "委派并等待检查", conversationId: parent.id }, (event) => {
        if (event.type !== "run.finished") return;
        completedConversations.add(event.conversationId);
        if (completedConversations.size === 2) resolve();
      });
    });

    await Promise.all([model.childRequestStarted, model.waitRequested]);
    const childRequest = model.requests.find((request) =>
      request.messages[0]?.content.includes("You are a temporary Subagent derived from parent conversation") === true
    );
    expect(childRequest).toBeDefined();
    expect(childRequest?.configuration.modelId).toBe("alternate-model");
    expect(childRequest?.messages.some((message) =>
      JSON.stringify(message.providerState)?.includes("call_spawn_subagent") === true
    )).toBe(false);
    expect(database.getConversation(parent.id).activeRunId).not.toBeNull();
    model.completeChild();
    await finished;

    const [task] = database.listSubagentTasks(parent.id);
    if (task === undefined) throw new Error("Subagent task was not created.");
    expect(database.getConversation(task.childConversationId).modelSelection).toEqual({
      modelId: "alternate-model",
      providerId,
      reasoning: { kind: "effort", value: "high" },
    });
    expect(task).toMatchObject({
      result: "Subagent 已完成检查",
      status: "completed",
      title: "实现检查",
    });
    expect(database.getConversation(task.childConversationId).avatarIcon).toBe("bug");
    expect(threadLog.readContext(task.childConversationId)?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "检查实现并报告结果",
        role: "user",
      }),
    ]));
    expect(threadLog.read(parent.id)?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "agent_message_read",
        "subagent_task_created",
        "subagent_task_completed",
      ]),
    );
    expect(database.listUnreadAgentMessages(parent.id)).toEqual([]);
    const parentTimeline = database.listTimeline(parent.id);
    expect(parentTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool", name: "spawn_subagent", status: "completed" }),
      expect.objectContaining({ kind: "tool", name: "wait_for_subagents", status: "completed" }),
      expect.objectContaining({
        content: "已等待并整合 Subagent 结果",
        kind: "message",
        role: "assistant",
      }),
    ]));
    expect(parentTimeline.some((item) =>
      item.kind === "agent_message" && item.messageType === "task_result"
    )).toBe(false);
    expect(() => runtime.sendMessage({
      content: "继续执行另一个任务",
      conversationId: task.childConversationId,
    }, () => undefined)).toThrow("read-only");
    await new Promise<void>((resolve) => setImmediate(resolve));
    database.close();
  });

  it("reactivates a completed parent conversation with its persisted model selection", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const parentSelection = {
      modelId: "parent-consolidation-model",
      providerId: crypto.randomUUID(),
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    const parent = database.createConversation(null, { modelSelection: parentSelection });
    const model = new SubagentLifecycleFixtureModel(false, undefined, undefined, null);
    const configurationCalls: Array<{ modelId: string | undefined; providerId: string | undefined }> = [];
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: (providerId?: string, modelId?: string) => {
          configurationCalls.push({ modelId, providerId });
          return {
            apiKey: "secret",
            apiFormat: "openai-chat-completions" as const,
            baseUrl: "https://example.test/v1",
            modelId: modelId ?? "test-model",
            reasoningOptions: modelId === parentSelection.modelId
              ? [parentSelection.reasoning]
              : [],
          };
        },
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    let parentFinishedCount = 0;
    const parentConversationUpdates: Array<{
      activeRunId: string | null;
      activeSubagentCount: number;
    }> = [];
    let resolveInitialParent: () => void = () => undefined;
    let resolveAllFinished: () => void = () => undefined;
    const initialParentFinished = new Promise<void>((resolve) => {
      resolveInitialParent = resolve;
    });
    const allFinished = new Promise<void>((resolve) => {
      resolveAllFinished = resolve;
    });
    runtime.sendMessage({ content: "后台委派检查", conversationId: parent.id }, (event) => {
      if (event.type === "conversation.updated" && event.conversation.id === parent.id) {
        parentConversationUpdates.push({
          activeRunId: event.conversation.activeRunId,
          activeSubagentCount: event.conversation.activeSubagentCount,
        });
      }
      if (event.type !== "run.finished") return;
      if (event.conversationId === parent.id) {
        parentFinishedCount += 1;
        if (parentFinishedCount === 1) resolveInitialParent();
      }
      const child = database.listSubagentTasks(parent.id)[0];
      if (
        parentFinishedCount === 2
        && child !== undefined
        && database.getConversation(child.childConversationId).activeRunId === null
      ) {
        resolveAllFinished();
      }
    });

    await Promise.all([model.childRequestStarted, initialParentFinished]);
    expect(database.getConversation(parent.id)).toMatchObject({
      activeRunId: null,
      activeSubagentCount: 1,
    });
    expect(parentConversationUpdates.some((update) =>
      update.activeRunId !== null && update.activeSubagentCount === 1,
    )).toBe(true);
    model.completeChild();
    await allFinished;

    expect(parentFinishedCount).toBe(2);
    const task = database.listSubagentTasks(parent.id)[0];
    if (task === undefined) throw new Error("Subagent task was not created.");
    expect(task.status).toBe("completed");
    expect(AGENT_AVATAR_ICONS).toContain(
      database.getConversation(task.childConversationId).avatarIcon,
    );
    expect(database.getConversation(parent.id).activeSubagentCount).toBe(0);
    expect(parentConversationUpdates).toContainEqual({
      activeRunId: null,
      activeSubagentCount: 0,
    });
    const parentTimeline = database.listTimeline(parent.id);
    expect(parentTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "父任务先完成，Subagent 继续后台运行",
        kind: "message",
        role: "assistant",
      }),
      expect.objectContaining({
        content: "已被 Subagent 结果重新激活",
        kind: "message",
        role: "assistant",
      }),
    ]));
    expect(parentTimeline.some((item) =>
      item.kind === "agent_message" && item.messageType === "task_result"
    )).toBe(false);
    const consolidationRequest = model.requests.find((request) => request.messages.some((message) =>
      message.content.includes("[Subagent task result]"),
    ));
    expect(consolidationRequest?.configuration.modelId).toBe(parentSelection.modelId);
    expect(configurationCalls).toContainEqual({
      modelId: parentSelection.modelId,
      providerId: parentSelection.providerId,
    });
    database.close();
  });

  it("runs a durable Team member with its WorkItem's frozen policy", async () => {
    const database = new AgentDatabase(":memory:");
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const projects = new ProjectRegistry(database);
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-managed-member-"));
    temporaryDirectories.push(projectRoot);
    const project = await projects.registerDirectory(projectRoot);
    const selection = {
      modelId: "team-frozen-model",
      providerId: crypto.randomUUID(),
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    const lead = directory.agents.find((agent) => agent.id === "team-lead");
    const explorer = directory.agents.find((agent) => agent.id === "explorer");
    if (lead === undefined || explorer === undefined) throw new Error("Team fixture is unavailable.");
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: ["成员结果已汇总"],
      modelSelection: selection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "请成员完成一次简单检查。",
      teamId: "default-team",
      title: "持久成员策略",
    }, selection);
    const root = database.createConversation(project.id, {
      agent: { id: lead.id, instructions: lead.instructions, isDefault: lead.isDefault, name: lead.name, role: lead.role },
      modelSelection: selection,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.bindTeamExecutionConversation({
      conversationId: root.id,
      projectId: project.id,
      sourceConversationId: null,
      teamId: "default-team",
    });
    const member = database.createConversation(project.id, {
      agent: { id: explorer.id, instructions: explorer.instructions, isDefault: explorer.isDefault, name: explorer.name, role: explorer.role },
      modelSelection: selection,
      parentConversationId: root.id,
      teamId: "default-team",
      threadKind: "agent",
    });
    database.bindTeamMemberConversation({
      agentId: explorer.id,
      conversationId: member.id,
      teamExecutionConversationId: root.id,
    });
    database.reserveTeamWorkItemExecution(workItem.id, root.id);
    const rootRun = database.createRunWithUserMessage(root.id, "请分派成员", selection.modelId);
    database.startTeamWorkItem(workItem.id, root.id, rootRun.runId);
    const model = new FixtureModel();
    const configurationCalls: Array<{ modelId: string | undefined; providerId: string | undefined }> = [];
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: (providerId?: string, modelId?: string) => {
          configurationCalls.push({ modelId, providerId });
          return {
            apiKey: "secret",
            apiFormat: "openai-chat-completions" as const,
            baseUrl: "https://example.test/v1",
            modelId: modelId ?? "global-default-model",
            reasoningOptions: modelId === selection.modelId ? [selection.reasoning] : [],
          };
        },
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      undefined,
      null,
      null,
      { getConfiguration: () => directory },
    );
    let resolveWorkerFinished: () => void = () => undefined;
    const workerFinished = new Promise<void>((resolve) => {
      resolveWorkerFinished = resolve;
    });
    database.sendAgentMessage({
      content: "检查项目目录并回复结论。",
      runId: rootRun.runId,
      senderConversationId: root.id,
      targetConversationId: member.id,
    });
    runtime.resumePendingMessages((event) => {
      if (event.type === "run.finished" && event.conversationId === member.id) {
        resolveWorkerFinished();
      }
    });
    await workerFinished;

    expect(configurationCalls).toContainEqual({
      modelId: selection.modelId,
      providerId: selection.providerId,
    });
    expect(database.listSubagentTasks(root.id)).toEqual([]);
    expect(database.listUnreadAgentMessages(root.id).some((message) => message.messageType === "agent_result")).toBe(true);
    database.close();
  });

  it("uses the threshold snapshot from send time to compact prior history", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new ContinuousConversationFixtureModel();
    let compressionConfiguration = {
      mode: "tokens" as const,
      percentageThreshold: 80,
      tokenThreshold: 2_000,
      version: 1 as const,
    };
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 200_000,
          modelId: "test-model",
          reasoningOptions: [],
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      { getConfiguration: () => compressionConfiguration }
    );
    const sendAndWait = (content: string): Promise<void> => new Promise((resolve) => {
      runtime.sendMessage({ content, conversationId: conversation.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });
    const previousMarker = `上一轮上下文标记-${"a".repeat(4_000)}`;
    await sendAndWait(previousMarker);

    const completion = new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: `当前轮上下文标记-${"b".repeat(4_000)}`, conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });
    compressionConfiguration = { ...compressionConfiguration, tokenThreshold: 100_000 };
    await completion;

    const requestMessages = model.requests[1]?.messages ?? [];
    expect(requestMessages.some((message) => message.content.includes("上一轮上下文标记"))).toBe(false);
    expect(requestMessages.some((message) => message.content.includes("当前轮上下文标记"))).toBe(true);
    database.close();
  });

  it("persists incremental checkpoints and sends the latest two turns verbatim", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    for (let turn = 1; turn <= 3; turn += 1) {
      const run = database.createRunWithUserMessage(
        conversation.id,
        `旧轮次-${turn}-${"x".repeat(12_000)}`,
        "test-model"
      );
      database.appendAssistantTurn({
        content: `旧轮次-${turn}-回答`,
        conversationId: conversation.id,
        messageId: `00000000-0000-4000-8000-${(100 + turn).toString().padStart(12, "0")}`,
        modelId: "test-model",
        runId: run.runId,
        toolCalls: []
      });
      database.finishRun(run.runId, "completed", null);
    }
    const model = new ContinuousConversationFixtureModel();
    const compactor = new FixtureContextCompactor();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      {
        getConfiguration: () => ({
          mode: "tokens",
          percentageThreshold: 80,
          tokenThreshold: 6_000,
          version: 1
        })
      },
      compactor
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        { content: `当前轮次-4-${"y".repeat(12_000)}`, conversationId: conversation.id },
        (event) => {
          if (event.type === "run.finished") resolve();
        }
      );
    });

    expect(compactor.requests).toHaveLength(2);
    expect(compactor.requests[0]?.previousSummary).toBeNull();
    expect(compactor.requests[1]?.previousSummary).toContain("已压缩到消息");
    const requestMessages = model.requests[0]?.messages ?? [];
    expect(requestMessages.some((message) => message.content.includes("旧轮次-1-"))).toBe(false);
    expect(requestMessages.some((message) => message.content.includes("旧轮次-2-"))).toBe(false);
    expect(requestMessages.some((message) => message.content.includes("旧轮次-3-"))).toBe(true);
    expect(requestMessages.some((message) => message.content.includes("当前轮次-4-"))).toBe(true);
    expect(requestMessages.some((message) =>
      message.role === "system" && message.content.includes("structured compression checkpoint")
    )).toBe(true);
    expect(database.getContextCheckpoint(conversation.id)?.summary).toContain("继续当前任务");
    expect(database.listModelMessages(conversation.id)).toHaveLength(8);
    database.close();
  });

  it("retrieves a keyword match from checkpoint-covered history as a dynamic reference", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const oldRun = database.createRunWithUserMessage(
      conversation.id,
      "旧问题：登录页校验规则",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "旧回答：沿用登录页校验组件。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: oldRun.runId,
      toolCalls: [],
    });
    database.finishRun(oldRun.runId, "completed", null);
    const coveredThroughSequence = database.listContextMessages(conversation.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected old context messages.");
    database.saveContextCheckpoint(
      conversation.id,
      coveredThroughSequence,
      "旧摘要：登录页校验组件已经确定。",
    );

    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "请结合登录页校验组件处理当前问题",
        conversationId: conversation.id,
      }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    const requestMessages = model.requests[0]?.messages ?? [];
    const related = requestMessages.find((message) =>
      message.role === "system" && message.content.includes("Relevant history retrieval"),
    );
    expect(related?.content).toContain("旧问题：登录页校验规则");
    expect(related?.content).toContain("旧回答：沿用登录页校验组件");
    expect(requestMessages.filter((message) => message.content === "旧问题：登录页校验规则"))
      .toHaveLength(0);
    expect(requestMessages.filter((message) => message.content === "旧回答：沿用登录页校验组件"))
      .toHaveLength(0);
    expect(runtime.getContextUsage({
      conversationId: conversation.id,
      permissionMode: "read_only",
    }).estimatedReferenceTokens).toBeGreaterThan(0);
    database.close();
  });

  it("falls back to complete-turn trimming when context compaction fails", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    for (let turn = 1; turn <= 3; turn += 1) {
      const run = database.createRunWithUserMessage(
        conversation.id,
        `回退旧轮次-${turn}-${"x".repeat(20_000)}`,
        "test-model"
      );
      database.appendAssistantTurn({
        content: `回退旧轮次-${turn}-回答`,
        conversationId: conversation.id,
        messageId: `00000000-0000-4000-8000-${(200 + turn).toString().padStart(12, "0")}`,
        modelId: "test-model",
        runId: run.runId,
        toolCalls: []
      });
      database.finishRun(run.runId, "completed", null);
    }
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      {
        getConfiguration: () => ({
          mode: "tokens",
          percentageThreshold: 80,
          tokenThreshold: 24_000,
          version: 1
        })
      },
      {
        compact: () => Promise.reject(new Error("summary provider unavailable"))
      }
    );

    const finished = await new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage(
          { content: `回退当前轮次-4-${"y".repeat(20_000)}`, conversationId: conversation.id },
          (event) => {
            if (event.type === "run.finished") resolve(event);
          }
        );
      }
    );

    expect(finished.status).toBe("completed");
    expect(database.getContextCheckpoint(conversation.id)).toBeNull();
    const requestMessages = model.requests[0]?.messages ?? [];
    expect(requestMessages.some((message) => message.content.includes("回退旧轮次-1-")))
      .toBe(false);
    // The external-read tool is always present in the model contract, so its
    // definitions consume part of the fixed budget. The current turn remains
    // intact while older turns are dropped when the configured threshold is full.
    expect(requestMessages.some((message) => message.content.includes("回退旧轮次-3-")))
      .toBe(false);
    expect(requestMessages.some((message) => message.content.includes("回退当前轮次-4-")))
      .toBe(true);
    database.close();
  });

  it("resolves a percentage threshold from the selected model context window", () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 200_000,
          modelId: "test-model",
          reasoningOptions: [],
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      undefined,
      undefined,
      {
        getConfiguration: () => ({
          mode: "percentage",
          percentageThreshold: 65,
          tokenThreshold: 100_000,
          version: 1,
        })
      }
    );

    expect(runtime.getContextUsage({
      conversationId: conversation.id,
      modelId: "test-model",
      permissionMode: "ask_before_changes",
      providerId: "00000000-0000-4000-8000-000000000001",
    }).compressionThresholdTokens).toBe(130_000);
    database.close();
  });

  it("calculates context usage without reading the provider API key", () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => {
          throw new Error("API key decryption must not run for context usage.");
        },
        getContextConfiguration: () => ({
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          contextWindow: 100_000,
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
    );

    expect(runtime.getContextUsage({
      conversationId: conversation.id,
      permissionMode: "ask_before_changes",
    }).compressionThresholdTokens).toBe(80_000);
    database.close();
  });

  it("prefers the selected model compression threshold over the global default", () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextCompression: {
            mode: "tokens",
            percentageThreshold: 80,
            tokenThreshold: 64_000,
          },
          contextWindow: 200_000,
          modelId: "test-model",
          reasoningOptions: [],
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      undefined,
      undefined,
      {
        getConfiguration: () => ({
          mode: "percentage",
          percentageThreshold: 65,
          tokenThreshold: 100_000,
          version: 1,
        })
      }
    );

    expect(runtime.getContextUsage({
      conversationId: conversation.id,
      modelId: "test-model",
      permissionMode: "ask_before_changes",
      providerId: "00000000-0000-4000-8000-000000000001",
    }).compressionThresholdTokens).toBe(64_000);
    database.close();
  });

  it("keeps oversized attachments as drafts when the current turn cannot fit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-attachment-budget-"));
    temporaryDirectories.push(root);
    const projectRoot = path.join(root, "project");
    const sourcePath = path.join(projectRoot, "large-notes.txt");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(sourcePath, "attachment context\n".repeat(4_000), "utf8");

    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(projectRoot);
    const conversation = database.createConversation(project.id);
    const attachments = new ConversationAttachmentStore(
      database,
      projects,
      path.join(root, "managed")
    );
    const [attachment] = await attachments.importFiles(conversation.id, [sourcePath]);
    if (attachment === undefined) throw new Error("Attachment fixture was not imported.");
    const model = new ContinuousConversationFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          contextWindow: 12_000,
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      undefined,
      {
        getConfiguration: () => ({
          mode: "tokens",
          percentageThreshold: 80,
          tokenThreshold: 10_000,
          version: 1
        })
      },
      null,
      attachments
    );

    expect(() => runtime.sendMessage({
      attachmentIds: [attachment.id],
      content: "分析附件",
      conversationId: conversation.id
    }, () => undefined)).toThrow("本次消息和附件预计至少需要");
    expect(database.listDraftConversationAttachments(conversation.id)).toHaveLength(1);
    expect(database.listTimeline(conversation.id)).toEqual([]);
    expect(model.requests).toEqual([]);
    database.close();
  });

  it("rejects a reasoning option that is not configured or enabled for the selected model", () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [{ enabled: false, kind: "effort", value: "low" }]
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      new FixtureModel()
    );

    expect(() => runtime.sendMessage(
      {
        content: "使用未启用的推理强度选项",
        conversationId: conversation.id,
        reasoning: { kind: "effort", value: "high" }
      },
      () => undefined
    )).toThrow("The selected reasoning option is not configured for this model.");
    expect(() => runtime.sendMessage(
      {
        content: "使用已禁用的推理强度选项",
        conversationId: conversation.id,
        reasoning: { kind: "effort", value: "low" }
      },
      () => undefined
    )).toThrow("The selected reasoning option is disabled for this model.");
    database.close();
  });

  it("persists a failed model request as an assistant timeline message", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const connectionStatuses: Array<[string, string, "healthy" | "error"]> = [];
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        }),
        setModelConnectionStatus: (providerId, modelId, status) => {
          connectionStatuses.push([providerId, modelId, status]);
        },
      },
      projects,
      new ProjectToolRegistry(projects),
      new FailingFixtureModel()
    );
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage(
          {
            content: "执行失败的请求",
            conversationId: conversation.id,
            providerId: "00000000-0000-4000-8000-000000000001",
          },
          (event) => {
            if (event.type === "run.finished") resolve(event);
          }
        );
      }
    );

    const finishedEvent = await finished;
    expect(finishedEvent).toMatchObject({
      agentError: {
        code: "MODEL_PROVIDER_UNAVAILABLE",
        retryable: true,
      },
      status: "failed"
    });
    expect(finishedEvent.error).toContain("模型服务暂时不可用");
    expect(connectionStatuses).toEqual([[
      "00000000-0000-4000-8000-000000000001",
      "test-model",
      "error",
    ]]);
    const failedTimeline = database.listTimeline(conversation.id);
    expect(failedTimeline).toEqual([
      expect.objectContaining({ role: "user", status: "completed" }),
      expect.objectContaining({
        modelId: "test-model",
        role: "assistant",
        status: "failed"
      })
    ]);
    const failedAssistantMessage = failedTimeline[1];
    if (failedAssistantMessage?.kind !== "message") {
      throw new Error("Expected an assistant failure message.");
    }
    expect(failedAssistantMessage.content).toContain("模型服务暂时不可用");
    expect(database.listModelMessages(conversation.id)).toEqual([
      expect.objectContaining({ content: "执行失败的请求", role: "user" })
    ]);
    database.close();
  });

  it("reconnects transient network and quota failures before completing a model turn", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new RetryingFixtureModel();
    const delays: number[] = [];
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      (delayMs, signal) => {
        delays.push(delayMs);
        signal.throwIfAborted();
        return Promise.resolve();
      }
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage(
          { content: "重试模型请求", conversationId: conversation.id },
          (event) => {
            events.push(event);
            if (event.type === "run.finished") resolve(event);
          }
        );
      }
    );

    await expect(finished).resolves.toMatchObject({ error: null, status: "completed" });
    expect(model.requests).toHaveLength(6);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(events.filter((event) => event.type === "model.request_started")).toHaveLength(6);
    expect(events.filter((event) => event.type === "model.request_retrying")).toEqual([
      expect.objectContaining({ attempt: 1, retryInMs: 1_000 }),
      expect.objectContaining({ attempt: 2, retryInMs: 2_000 }),
      expect.objectContaining({ attempt: 3, retryInMs: 4_000 }),
      expect.objectContaining({ attempt: 4, retryInMs: 8_000 }),
      expect.objectContaining({ attempt: 5, retryInMs: 16_000 })
    ]);
    expect(database.listTimeline(conversation.id)).toEqual([
      expect.objectContaining({ content: "重试模型请求", role: "user" }),
      expect.objectContaining({ content: "连接已恢复", role: "assistant", status: "completed" })
    ]);
    database.close();
  });

  it("retries an empty model turn before accepting a later visible response", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new EmptyThenSuccessfulFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      () => Promise.resolve()
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage(
          { content: "重试空响应", conversationId: conversation.id },
          (event) => {
            events.push(event);
            if (event.type === "run.finished") resolve(event);
          }
        );
      }
    );

    await expect(finished).resolves.toMatchObject({ error: null, status: "completed" });
    expect(model.requests).toBe(2);
    expect(events.filter((event) => event.type === "model.request_retrying")).toEqual([
      expect.objectContaining({ attempt: 1, retryInMs: 1_000 })
    ]);
    expect(database.listTimeline(conversation.id)).toEqual([
      expect.objectContaining({ content: "重试空响应", role: "user" }),
      expect.objectContaining({ content: "空响应重试成功", role: "assistant", status: "completed" })
    ]);
    database.close();
  });

  it("does not repeat a model request after it has streamed text", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new PartialStreamFailureFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
      () => Promise.resolve()
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage(
          { content: "不重复流式回复", conversationId: conversation.id },
          (event) => {
            events.push(event);
            if (event.type === "run.finished") resolve(event);
          }
        );
      }
    );

    await expect(finished).resolves.toMatchObject({ status: "failed" });
    expect(model.requests).toBe(1);
    expect(events.filter((event) => event.type === "model.request_retrying")).toHaveLength(0);
    expect(events.filter((event) => event.type === "assistant.delta")).toHaveLength(1);
    database.close();
  });

  it("waits for command approval before executing PowerShell in the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-command-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const threadLog = new ThreadLog(path.join(root, "conversations"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      new CommandFixtureModel(),
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      null,
      undefined,
      null,
      threadLog,
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "执行测试命令",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes"
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        }
      );
    });

    await finished;

    const command = database
      .listTimeline(conversation.id)
      .find((item) => item.kind === "tool" && item.name === "run_command");
    expect(events.map((event) => event.type)).toContain("tool.approval_requested");
    const outputEvents = events.filter((event) => event.type === "tool.output_delta");
    expect(outputEvents.length).toBeGreaterThan(0);
    expect(outputEvents.some((event) => event.type === "tool.output_delta" && event.delta.includes("agent-command-ok")))
      .toBe(true);
    expect(command).toMatchObject({ status: "completed" });
    if (command?.kind !== "tool") throw new Error("Expected a command tool event.");
    expect(command.result).toContain("agent-command-ok");
    const logEventTypes = threadLog.read(conversation.id)?.events.map((event) => event.type) ?? [];
    expect(logEventTypes.indexOf("tool_execution_prepared"))
      .toBeGreaterThan(logEventTypes.indexOf("tool_call_requested"));
    expect(logEventTypes.indexOf("tool_approval_requested"))
      .toBeGreaterThan(logEventTypes.indexOf("tool_execution_prepared"));
    expect(logEventTypes.indexOf("tool_approval_decided"))
      .toBeGreaterThan(logEventTypes.indexOf("tool_approval_requested"));
    expect(logEventTypes.indexOf("tool_result"))
      .toBeGreaterThan(logEventTypes.indexOf("tool_approval_decided"));
    database.close();
  });

  it("terminalizes a pending tool approval when its Run is stopped", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-cancel-approval-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new CommandFixtureModel(),
      () => Promise.resolve(),
    );
    const finished = new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(
      (resolve) => {
        runtime.sendMessage({
          content: "等待审批后停止",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes",
        }, (event) => {
          if (event.type === "tool.approval_requested") runtime.cancelRun(event.runId);
          if (event.type === "run.finished") resolve(event);
        });
      },
    );

    await expect(finished).resolves.toMatchObject({ status: "cancelled" });
    expect(database.listTimeline(conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "run_command",
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      }),
    ]));
    database.close();
  });

  it("matches exact and trailing-wildcard Agent command rules at the Main boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-permission-rule-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const profile = DEFAULT_APPLICATION_SETTINGS.agentDirectory.agents.find((agent) => agent.id === "implementer");
    if (profile === undefined) throw new Error("Implementer profile is missing.");
    const conversation = database.createConversation(project.id, {
      agent: {
        id: profile.id,
        instructions: profile.instructions,
        isDefault: profile.isDefault,
        name: profile.name,
        role: profile.role,
      },
    });
    const settings = createPermissionSettingsProvider(profile.id, [
      { pattern: "Write-Output *", tool: "run_command" },
    ]);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new SingleCommandFixtureModel("Write-Output agent-command-ok"),
      undefined,
      undefined,
      null,
      null,
      { getConfiguration: () => settings.getConfiguration().agentDirectory },
      null,
      null,
      undefined,
      settings,
    );
    const allowedEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "匹配通配规则",
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        allowedEvents.push(event);
        if (event.type === "run.finished") resolve();
      });
    });
    expect(allowedEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(0);

    const nonMatchingConversation = database.createConversation(project.id, {
      agent: {
        id: profile.id,
        instructions: profile.instructions,
        isDefault: profile.isDefault,
        name: profile.name,
        role: profile.role,
      },
    });
    const nonMatchingRuntime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new SingleCommandFixtureModel("Write-Outputx agent-command-ok"),
      undefined,
      undefined,
      null,
      null,
      { getConfiguration: () => settings.getConfiguration().agentDirectory },
      null,
      null,
      undefined,
      settings,
    );
    const rejectedBoundaryEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      nonMatchingRuntime.sendMessage({
        content: "不能匹配相邻命令名",
        conversationId: nonMatchingConversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        rejectedBoundaryEvents.push(event);
        if (event.type === "tool.approval_requested") {
          nonMatchingRuntime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    // A matching prefix is allowed; a different command is still presented
    // for approval. Keep the command local and deterministic for CI.
    expect(rejectedBoundaryEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(1);
    database.close();
  });

  it("persists Agent approval and keeps a session grant scoped to one conversation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-permission-scope-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const profile = DEFAULT_APPLICATION_SETTINGS.agentDirectory.agents.find((agent) => agent.id === "implementer");
    if (profile === undefined) throw new Error("Implementer profile is missing.");
    const binding = {
      id: profile.id,
      instructions: profile.instructions,
      isDefault: profile.isDefault,
      name: profile.name,
      role: profile.role,
    };
    const conversation = database.createConversation(project.id, { agent: binding });
    const otherConversation = database.createConversation(project.id, { agent: binding });
    const settings = createPermissionSettingsProvider(profile.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new RepeatingCommandFixtureModel([
        "Write-Output agent-command-ok",
        "Write-Output temporary-session-ok",
        "Write-Output temporary-session-ok",
        "Write-Output temporary-session-ok",
      ]),
      undefined,
      undefined,
      null,
      null,
      { getConfiguration: () => settings.getConfiguration().agentDirectory },
      null,
      null,
      undefined,
      settings,
    );
    const firstConversationEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "保存 Agent 命令权限",
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        firstConversationEvents.push(event);
        if (event.type === "tool.approval_requested") {
          runtime.approveToolChange({ approved: true, runId: event.runId, scope: "agent", toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect(firstConversationEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(1);
    expect(settings.getConfiguration().agentDirectory.agents.find((agent) => agent.id === profile.id)?.permissions.allow)
      .toContainEqual({ pattern: "Write-Output agent-command-ok", tool: "run_command" });

    const sessionEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "当前会话授权",
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        sessionEvents.push(event);
        if (event.type === "tool.approval_requested") {
          runtime.approveToolChange({ approved: true, runId: event.runId, scope: "session", toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    const subsequentEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "复用当前会话授权",
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        subsequentEvents.push(event);
        if (event.type === "run.finished") resolve();
      });
    });
    expect(sessionEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(1);
    expect(subsequentEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(0);

    const otherEvents: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "其他会话仍需审批",
        conversationId: otherConversation.id,
        permissionMode: "ask_before_changes",
      }, (event) => {
        otherEvents.push(event);
        if (event.type === "tool.approval_requested") {
          runtime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect(otherEvents.filter((event) => event.type === "tool.approval_requested")).toHaveLength(1);
    database.close();
  });

  it("requires approval before reading an absolute file outside the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-external-read-"));
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-external-file-"));
    temporaryDirectories.push(root, externalRoot);
    const externalPath = path.join(externalRoot, "outside.txt");
    await writeFile(externalPath, "outside approval content\n", "utf8");
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new ExternalReadFixtureModel(externalPath),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({
        content: "读取工作区外文件",
        conversationId: conversation.id,
        permissionMode: "full_access",
      }, (event) => {
        events.push(event);
        if (event.type === "tool.approval_requested") {
          const pending = database.listTimeline(conversation.id).find(
            (item) => item.kind === "tool" && item.name === "read_external_file",
          );
          expect(pending?.kind === "tool" ? pending.result : null).toBeNull();
          runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect(events.filter((event) => event.type === "tool.approval_requested")).toHaveLength(1);
    const tool = database.listTimeline(conversation.id).find(
      (item) => item.kind === "tool" && item.name === "read_external_file",
    );
    expect(tool?.kind === "tool" ? tool.result : null).toContain("outside approval content");
    database.close();
  });

  it("waits for an approved diff before writing a project file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-change-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: []
        })
      },
      projects,
      new ProjectToolRegistry(projects),
      new FileChangeFixtureModel()
    );
    const events: ConversationRunEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "创建文件",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes"
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        }
      );
    });
    await finished;

    await expect(readFile(path.join(root, "feature.ts"), "utf8")).resolves.toBe(
      "export const enabled = true;\n"
    );
    expect(events.map((event) => event.type)).toContain("tool.approval_requested");
    const fileChangedEvent = events.find(
      (event) => event.type === "tool.completed" && event.fileChange !== null,
    );
    expect(fileChangedEvent?.type).toBe("tool.completed");
    if (fileChangedEvent?.type !== "tool.completed") {
      throw new Error("Expected a completed file-change event.");
    }
    expect(fileChangedEvent.fileChange).toEqual({
      operation: "write_file",
      path: "feature.ts",
      projectId: project.id,
    });
    const tool = database.listTimeline(conversation.id).find((item) => item.kind === "tool");
    expect(tool?.kind).toBe("tool");
    if (tool?.kind !== "tool") throw new Error("Expected a file tool timeline item.");
    expect(tool.status).toBe("completed");
    expect(tool.diff).toContain("feature.ts");
    database.close();
  });

  it("rejects an approved overwrite when the file changes while approval is pending", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-stale-approval-"));
    temporaryDirectories.push(root);
    const targetPath = path.join(root, "target.txt");
    await writeFile(targetPath, "original\n", "utf8");
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new OverwriteFileFixtureModel(),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "覆盖文件",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes",
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            writeFileSync(targetPath, "external\n", "utf8");
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await expect(readFile(targetPath, "utf8")).resolves.toBe("external\n");
    const completedTool = events.find(
      (event) => event.type === "tool.completed" && event.tool.name === "write_file",
    );
    expect(completedTool?.type).toBe("tool.completed");
    if (completedTool?.type !== "tool.completed") throw new Error("Expected a completed tool event.");
    expect(completedTool.tool.status).toBe("failed");
    expect(completedTool.tool.result).toContain("FILE_CHANGED");
    database.close();
  });

  it("does not replay completed side effects when a later ToolCall interrupts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-multi-approval-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new MultiChangeFixtureModel(),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "创建两个文件",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes",
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        },
      );
    });

    expect(events.filter((event) => event.type === "tool.approval_requested")).toHaveLength(2);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(2);
    const tools = database.listTimeline(conversation.id).filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]?.kind === "tool" ? tools[0].batchId : undefined)
      .toBe(tools[1]?.kind === "tool" ? tools[1].batchId : undefined);
    await expect(readFile(path.join(root, "first.ts"), "utf8"))
      .resolves.toBe("export const first = true;\n");
    await expect(readFile(path.join(root, "second.ts"), "utf8"))
      .resolves.toBe("export const second = true;\n");
    database.close();
  });

  it("keeps a larger approval batch below the LangGraph recursion guard", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-many-approval-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new ManyChangeFixtureModel(10),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "创建十个文件",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes",
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        },
      );
    });

    expect(events.some((event) => event.type === "run.finished" && event.status === "failed")).toBe(false);
    expect(events.filter((event) => event.type === "tool.approval_requested")).toHaveLength(10);
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool" && item.status === "completed"))
      .toHaveLength(10);
    await expect(readFile(path.join(root, "approval-9.ts"), "utf8"))
      .resolves.toBe("export const value9 = 9;\n");
    database.close();
  });

  it("bounds parallel reads and preserves every result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-parallel-read-"));
    temporaryDirectories.push(root);
    const paths = Array.from({ length: 10 }, (_, index) => `file-${index}.txt`);
    await Promise.all(paths.map((filePath, index) =>
      writeFile(path.join(root, filePath), `${index}\n`, "utf8")
    ));
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const tools = new ProjectToolRegistry(projects);
    const originalExecute = tools.execute.bind(tools);
    let activeReads = 0;
    let maximumActiveReads = 0;
    vi.spyOn(tools, "execute").mockImplementation(async (...args) => {
      if (args[0] === "read_file") {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 40));
        try {
          return await originalExecute(...args);
        } finally {
          activeReads -= 1;
        }
      }
      return originalExecute(...args);
    });
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      tools,
      new MultiReadFixtureModel(paths),
    );
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "读取多个文件", conversationId: conversation.id }, (event) => {
        if (event.type === "run.finished") resolve();
      });
    });

    expect(maximumActiveReads).toBe(8);
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool"))
      .toHaveLength(paths.length);
    database.close();
  });

  it("runs default parallel commands together in full-access mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-parallel-command-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const tools = new ProjectToolRegistry(projects);
    let activeCommands = 0;
    let maximumActiveCommands = 0;
    vi.spyOn(tools, "executePreparedCommand").mockImplementation(async () => {
      activeCommands += 1;
      maximumActiveCommands = Math.max(maximumActiveCommands, activeCommands);
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeCommands -= 1;
      return {
        content: JSON.stringify({ ok: true, value: { status: "completed" } }),
        isError: false,
        kind: "completed",
      };
    });
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      tools,
      new MultiCommandFixtureModel(
        ["one", "two", "three", "four", "five", "six"],
        false,
      ),
    );
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "执行两个独立命令",
          conversationId: conversation.id,
          permissionMode: "full_access",
        },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    expect(maximumActiveCommands).toBe(4);
    const commandTools = database.listTimeline(conversation.id)
      .filter((item): item is ConversationToolItem => item.kind === "tool");
    expect(commandTools).toHaveLength(6);
    expect(commandTools.every((tool) => tool.executionMode === "parallel")).toBe(true);
    database.close();
  });

  it("keeps mixed tool calls parallel within safe groups and ordered across command barriers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-mixed-tools-"));
    temporaryDirectories.push(root);
    await Promise.all([
      writeFile(path.join(root, "one.txt"), "one\n", "utf8"),
      writeFile(path.join(root, "two.txt"), "two\n", "utf8"),
      writeFile(path.join(root, "three.txt"), "three\n", "utf8"),
    ]);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const tools = new ProjectToolRegistry(projects);
    const originalExecute = tools.execute.bind(tools);
    const activity: string[] = [];
    let activeReads = 0;
    let maximumActiveReads = 0;
    vi.spyOn(tools, "execute").mockImplementation(async (...args) => {
      if (args[0] !== "read_file") return originalExecute(...args);
      const payload = JSON.parse(args[1]) as { path: string };
      activity.push(`read:start:${payload.path}`);
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 35));
      try {
        return await originalExecute(...args);
      } finally {
        activeReads -= 1;
        activity.push(`read:end:${payload.path}`);
      }
    });
    vi.spyOn(tools, "executePreparedCommand").mockImplementation(async (command) => {
      activity.push(`command:start:${command.command}`);
      await new Promise((resolve) => setTimeout(resolve, 35));
      activity.push(`command:end:${command.command}`);
      return {
        content: JSON.stringify({ ok: true, value: { status: "completed" } }),
        isError: false,
        kind: "completed",
      };
    });
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      tools,
      new MixedReadCommandFixtureModel(),
    );

    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "混合执行工具",
          conversationId: conversation.id,
          permissionMode: "full_access",
        },
        (event) => {
          if (event.type === "run.finished") resolve();
        },
      );
    });

    expect(maximumActiveReads).toBe(2);
    expect(activity.indexOf("command:start:middle")).toBeGreaterThan(
      activity.indexOf("read:end:one.txt"),
    );
    expect(activity.indexOf("command:start:middle")).toBeGreaterThan(
      activity.indexOf("read:end:two.txt"),
    );
    expect(activity.indexOf("read:start:three.txt")).toBeGreaterThan(
      activity.indexOf("command:end:middle"),
    );
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool"))
      .toHaveLength(4);
    database.close();
  });

  it("runs independent commands in parallel after individual approvals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-parallel-approval-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const tools = new ProjectToolRegistry(projects);
    let activeCommands = 0;
    let maximumActiveCommands = 0;
    const executedCommands: string[] = [];
    vi.spyOn(tools, "executePreparedCommand").mockImplementation(async (command) => {
      executedCommands.push(command.command);
      activeCommands += 1;
      maximumActiveCommands = Math.max(maximumActiveCommands, activeCommands);
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeCommands -= 1;
      return { content: JSON.stringify({ ok: true, value: { status: "completed" } }), isError: false, kind: "completed" };
    });
    const runtime = new AgentRuntime(
      database,
      { getConfiguration: () => ({ apiKey: "secret", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", modelId: "test-model", reasoningOptions: [] }) },
      projects,
      tools,
      new MultiCommandFixtureModel(["one", "two", "three", "four", "five", "six"], false),
    );
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "并行审批命令", conversationId: conversation.id, permissionMode: "ask_before_changes" }, (event) => {
        if (event.type === "tool.approval_requested") runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
        if (event.type === "run.finished") resolve();
      });
    });
    expect(maximumActiveCommands).toBe(4);
    expect(executedCommands.sort()).toEqual(["five", "four", "one", "six", "three", "two"]);
    const commandTools = database.listTimeline(conversation.id)
      .filter((item): item is ConversationToolItem => item.kind === "tool");
    expect(commandTools).toHaveLength(6);
    expect(commandTools.every((tool) => tool.executionMode === "parallel")).toBe(true);
    database.close();
  });

  it("rejects an oversized model tool batch before executing any tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-tool-call-limit-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new MultiReadFixtureModel(
      Array.from({ length: 33 }, (_, index) => `file-${index}.txt`),
    );
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "批量读取", conversationId: conversation.id }, (event) => {
        events.push(event);
        if (event.type === "run.finished") resolve();
      });
    });

    const finished = events.find((event) => event.type === "run.finished");
    expect(finished?.type).toBe("run.finished");
    if (finished?.type !== "run.finished") throw new Error("Expected a finished run event.");
    expect(finished.status).toBe("failed");
    expect(finished.agentError).toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
    expect(finished.error).toContain("32");
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(0);
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool"))
      .toHaveLength(0);
    expect(model.requests).toHaveLength(1);
    database.close();
  });

  it("rejects duplicate tool call IDs before executing any tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-duplicate-tool-call-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new DuplicateToolCallIdFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "批量读取", conversationId: conversation.id }, (event) => {
        events.push(event);
        if (event.type === "run.finished") resolve();
      });
    });

    const finished = events.find((event) => event.type === "run.finished");
    expect(finished?.type).toBe("run.finished");
    if (finished?.type !== "run.finished") throw new Error("Expected a finished run event.");
    expect(finished.status).toBe("failed");
    expect(finished.agentError).toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(0);
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool"))
      .toHaveLength(0);
    expect(model.requests).toHaveLength(1);
    database.close();
  });

  it("rejects a tool call ID reused from an earlier model turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-reused-tool-call-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "one.txt"), "one", "utf8");
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const model = new ReusedToolCallIdFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "重复读取", conversationId: conversation.id }, (event) => {
        events.push(event);
        if (event.type === "run.finished") resolve();
      });
    });

    const finished = events.find((event) => event.type === "run.finished");
    expect(finished?.type).toBe("run.finished");
    if (finished?.type !== "run.finished") throw new Error("Expected a finished run event.");
    expect(finished.status).toBe("failed");
    expect(finished.agentError).toMatchObject({ code: "MODEL_RESPONSE_INVALID" });
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(1);
    expect(database.listTimeline(conversation.id).filter((item) => item.kind === "tool"))
      .toHaveLength(1);
    expect(model.requests).toHaveLength(2);
    database.close();
  });

  it("returns an unknown tool call as a failed ToolMessage so the model can recover", async () => {
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const conversation = database.createConversation(null);
    const model = new UnknownToolFixtureModel();
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      model,
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "调用工具", conversationId: conversation.id }, (event) => {
        events.push(event);
        if (event.type === "run.finished") resolve();
      });
    });

    const finished = events.find((event) => event.type === "run.finished");
    expect(finished).toMatchObject({ status: "completed", type: "run.finished" });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages).toContainEqual(expect.objectContaining({
      role: "tool",
      toolCallId: "call_unknown_tool",
    }));
    expect(database.listTimeline(conversation.id)).toContainEqual(expect.objectContaining({
      kind: "tool",
      name: "missing_tool",
      status: "failed",
    }));
    database.close();
  });

  it("prepares same-file changes before the first write and discards the stale call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-same-file-batch-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "shared.txt"), "base\n", "utf8");
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      new ProjectToolRegistry(projects),
      new SameFileChangeFixtureModel(),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage(
        {
          content: "同时修改同一个文件",
          conversationId: conversation.id,
          permissionMode: "ask_before_changes",
        },
        (event) => {
          events.push(event);
          if (event.type === "tool.approval_requested") {
            runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id });
          }
          if (event.type === "run.finished") resolve();
        },
      );
    });

    await expect(readFile(path.join(root, "shared.txt"), "utf8")).resolves.toBe("first\n");
    const completed = events.filter((event) => event.type === "tool.completed");
    expect(completed).toHaveLength(2);
    expect(completed[0]?.type === "tool.completed" ? completed[0].tool.status : undefined)
      .toBe("completed");
    expect(completed[1]?.type === "tool.completed" ? completed[1].tool.status : undefined)
      .toBe("failed");
    expect(completed[1]?.type === "tool.completed" ? completed[1].tool.result : "")
      .toContain("FILE_CHANGED");
    database.close();
  });

  it("persists an unexpected tool adapter failure as a failed tool result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-tool-failure-"));
    temporaryDirectories.push(root);
    const database = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database);
    const project = await projects.registerDirectory(root);
    const conversation = database.createConversation(project.id);
    const tools = new ProjectToolRegistry(projects);
    vi.spyOn(tools, "execute").mockRejectedValue(new Error("fixture tool adapter failed"));
    const runtime = new AgentRuntime(
      database,
      {
        getConfiguration: () => ({
          apiKey: "secret",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          modelId: "test-model",
          reasoningOptions: [],
        }),
      },
      projects,
      tools,
      new FixtureModel(),
    );
    const events: ConversationRunEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.sendMessage({ content: "读取项目", conversationId: conversation.id }, (event) => {
        events.push(event);
        if (event.type === "run.finished") resolve();
      });
    });

    const tool = database.listTimeline(conversation.id).find((item) => item.kind === "tool");
    expect(tool).toMatchObject({ name: "list_directory", status: "failed" });
    expect(tool?.kind === "tool" ? tool.result : "").toContain("fixture tool adapter failed");
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    database.close();
  });
});
