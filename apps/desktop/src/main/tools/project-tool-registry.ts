import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  DEFAULT_TERMINAL_CONFIGURATION,
  relativeProjectPathSchema,
  type TerminalConfiguration,
  type TerminalOutputEncoding,
  type TerminalShell,
} from "@agent/protocol";
import { rgPath } from "@vscode/ripgrep";
import { applyPatch, createTwoFilesPatch, parsePatch } from "diff";
import { z } from "zod";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { toolErrorContent } from "../errors/tool-error.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { findFilesWithRipgrep, searchTextWithRipgrep } from "./ripgrep-search.js";

const MAX_READ_FILE_BYTES = 250_000;
// A full replacement can contain both the old and new text in the persisted diff.
const MAX_EDIT_FILE_BYTES = 200_000;
const MAX_READ_LINES = 400;
const MAX_FIND_RESULTS = 500;
const MAX_COMMAND_LENGTH = 4_000;
const MAX_COMMAND_OUTPUT_LENGTH = 200_000;
const MAX_COMMAND_TIMEOUT_MS = 30 * 60_000;
const MAX_COMMAND_WAIT_MS = 10 * 60_000;
const MAX_COMMAND_YIELD_MS = 30_000;

type TerminalConfigurationProvider = {
  getConfiguration(): TerminalConfiguration;
};

type ResolvedTerminalShell = Exclude<TerminalShell, "system">;

type TerminalLaunch = {
  args: string[];
  displayName: string;
  executable: string;
  shell: ResolvedTerminalShell;
};

const DEFAULT_TERMINAL_CONFIGURATION_PROVIDER: TerminalConfigurationProvider = {
  getConfiguration: () => structuredClone(DEFAULT_TERMINAL_CONFIGURATION),
};

const listDirectoryArgumentsSchema = z
  .object({
    path: relativeProjectPathSchema.default("")
      .describe("Project-relative POSIX directory path. Use an empty string for the root."),
  })
  .strict();

const readFileArgumentsSchema = z
  .object({
    endLine: z.number().int().positive().optional()
      .describe(`Optional inclusive end line; the selected range may contain at most ${MAX_READ_LINES} lines.`),
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }).describe("Project-relative POSIX file path."),
    startLine: z.number().int().positive().default(1)
      .describe("One-based first line to return.")
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endLine === undefined || value.endLine >= value.startLine) {
      if (
        value.endLine !== undefined
        && value.endLine - value.startLine + 1 > MAX_READ_LINES
      ) {
        context.addIssue({
          code: "custom",
          message: `The selected line range cannot exceed ${MAX_READ_LINES} lines. Lower endLine or raise startLine.`,
          path: ["endLine"],
        });
      }
      return;
    }
    context.addIssue({
      code: "custom",
      message: "endLine must be greater than or equal to startLine.",
      path: ["endLine"],
    });
  });

const searchTextArgumentsSchema = z
  .object({
    caseMode: z.enum(["smart", "sensitive", "insensitive"]).default("smart")
      .describe("Case handling: smart follows query casing; sensitive or insensitive forces the mode."),
    excludeGlobs: z.array(z.string().trim().min(1).max(200)).max(20).default([])
      .describe("Optional ripgrep exclude globs."),
    includeGlobs: z.array(z.string().trim().min(1).max(200)).max(20).default([])
      .describe("Optional ripgrep include globs."),
    maxResults: z.number().int().min(1).max(100).default(50)
      .describe("Maximum number of matching lines to return."),
    mode: z.enum(["literal", "regex"]).default("literal")
      .describe("literal searches exact text; regex interprets query as a regular expression."),
    path: relativeProjectPathSchema.default("")
      .describe("Optional project-relative POSIX directory path; empty means the project root."),
    query: z.string().min(1).max(200).describe("Literal text or regular expression to search for.")
  })
  .strict();

const findFilesArgumentsSchema = z
  .object({
    maxResults: z.number().int().min(1).max(MAX_FIND_RESULTS).default(200)
      .describe("Maximum number of file paths to return."),
    path: relativeProjectPathSchema.default("")
      .describe("Optional project-relative POSIX directory path; empty means the project root."),
    pattern: z.string().min(1).max(200)
      .describe("Ripgrep glob such as **/package.json or src/**/*.ts.")
  })
  .strict();

const writeFileArgumentsSchema = z
  .object({
    content: z.string().max(MAX_EDIT_FILE_BYTES).describe("Complete UTF-8 contents for the file."),
    overwrite: z.boolean().default(false)
      .describe("Allow replacing an existing file; false rejects existing targets."),
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }).describe("Project-relative POSIX file path.")
  })
  .strict();

const deleteFileArgumentsSchema = z
  .object({
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }).describe("Project-relative POSIX file path.")
  })
  .strict();

const replaceInFileArgumentsSchema = z
  .object({
    expectedReplacements: z.number().int().min(1).max(100).default(1)
      .describe("Exact number of oldText occurrences required before preparing the change."),
    newText: z.string().max(MAX_EDIT_FILE_BYTES).describe("Replacement UTF-8 text."),
    oldText: z.string().min(1).max(MAX_EDIT_FILE_BYTES)
      .describe("Exact UTF-8 text expected in the current file."),
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }).describe("Project-relative POSIX file path.")
  })
  .strict();

const applyPatchArgumentsSchema = z
  .object({
    patch: z.string().min(1).max(MAX_EDIT_FILE_BYTES)
      .describe("Standard unified diff with --- and +++ file headers for one existing file."),
  })
  .strict();

const runCommandArgumentsSchema = z
  .object({
    command: z.string().trim().min(1).max(MAX_COMMAND_LENGTH)
      .describe("One non-interactive command for the configured project shell."),
    parallel: z.boolean().default(false)
      .describe("Allow this command to run alongside another independent command in the same run."),
    timeoutMs: z.number().int().min(1_000).max(MAX_COMMAND_TIMEOUT_MS).default(60_000)
      .describe("Maximum execution time in milliseconds before the process is terminated."),
    yieldTimeMs: z.number().int().min(0).max(MAX_COMMAND_YIELD_MS).default(10_000)
      .describe("How long to wait for a quick result before returning a commandId."),
  })
  .strict();

const waitForCommandsArgumentsSchema = z.object({
  commandIds: z.array(z.string().uuid()).min(1).max(20)
    .describe("Command UUIDs returned by run_command."),
  timeoutMs: z.number().int().min(1_000).max(MAX_COMMAND_WAIT_MS).default(30_000)
    .describe("Maximum duration of this wait; it does not stop the commands."),
  waitFor: z.enum(["any", "all"]).default("all")
    .describe("any returns after one command finishes; all waits for every selected command."),
}).strict();

const stopCommandArgumentsSchema = z.object({
  commandId: z.string().uuid().describe("Command UUID returned by run_command."),
}).strict();

const listProjectOperationsArgumentsSchema = z.object({}).strict();
const waitForProjectOperationArgumentsSchema = z.object({
  operationId: z.string().uuid().describe("Operation UUID returned by a project conflict result."),
  timeoutMs: z.number().int().min(1_000).max(MAX_COMMAND_TIMEOUT_MS).default(30_000)
    .describe("Maximum duration of this wait; it does not cancel the conflicting operation."),
}).strict();

export type ToolExecutionResult = {
  kind: "completed";
  content: string;
  isError: boolean;
  status?: "rejected";
};

export type PreparedFileChange = {
  content: string | null;
  diff: string;
  expectedContent: string | null;
  operation: "apply_patch" | "delete_file" | "replace_in_file" | "write_file";
  path: string;
};

export type PreparedCommand = {
  command: string;
  parallel: boolean;
  timeoutMs: number;
  yieldTimeMs: number;
};

export type ProjectOperationOwner = {
  conversationId: string;
  conversationTitle: string;
  runId: string;
};

type ProjectOperationScope =
  | { kind: "command"; command: string; parallel: boolean }
  | { kind: "file"; path: string };

type CommandSessionStatus = "running" | "completed" | "failed" | "cancelled";

type CommandSession = {
  command: string;
  commandId: string;
  completedAt: string | null;
  completion: Promise<void>;
  error: string | null;
  exitCode: number | null;
  projectId: string;
  outputEncoding: TerminalOutputEncoding;
  startedAt: string;
  status: CommandSessionStatus;
  stderrChunks: Buffer[];
  stderrByteLength: number;
  stdoutChunks: Buffer[];
  stdoutByteLength: number;
  terminal: TerminalLaunch;
  terminate: (cancelled: boolean) => void;
  timedOut: boolean;
  truncated: boolean;
  workingDirectory: string;
};

type ProjectOperationRecord = ProjectOperationOwner & {
  completedAt: string | null;
  completion: Promise<void>;
  operationId: string;
  projectId: string;
  scope: ProjectOperationScope;
  startedAt: string;
  status: "active" | "completed" | "failed";
};

class ProjectOperationConflictError extends Error {
  public constructor(public readonly conflict: ProjectOperationRecord) {
    super(`Project operation conflicts with conversation ${conflict.conversationTitle}.`);
    this.name = "ProjectOperationConflictError";
  }
}

export type ToolExecution =
  | ToolExecutionResult
  | {
      change: PreparedFileChange;
      content: string;
      isError: false;
      kind: "change";
    }
  | {
      command: PreparedCommand;
      content: string;
      isError: false;
      kind: "command";
    };

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}

export class ProjectToolRegistry {
  private readonly projectOperations = new Map<string, ProjectOperationRecord>();

  private readonly commandSessions = new Map<string, CommandSession>();

  public constructor(
    private readonly projects: ProjectRegistry,
    private readonly terminalConfiguration: TerminalConfigurationProvider =
      DEFAULT_TERMINAL_CONFIGURATION_PROVIDER,
  ) {}

  public getDefinitions(): ModelToolDefinition[] {
    const commandEnvironment = this.getCommandEnvironmentDescription();

    return [
      {
        description:
          "List project mutations currently owned by other Agent conversations. Use this after a PROJECT_OPERATION_CONFLICT result.",
        name: "list_project_operations",
        parameters: modelToolParameters(listProjectOperationsArgumentsSchema)
      },
      {
        description:
          "Wait for one project operation to finish. Use its operationId from a conflict result; the wait is cancellable and bounded.",
        name: "wait_for_project_operation",
        parameters: modelToolParameters(waitForProjectOperationArgumentsSchema)
      },
      {
        description:
          "Wait for one or more background commands returned by run_command. waitFor=any returns when one finishes; waitFor=all waits for every command. timeoutMs only bounds this wait and does not stop commands.",
        name: "wait_for_commands",
        parameters: modelToolParameters(waitForCommandsArgumentsSchema),
      },
      {
        description: "Stop one running background command by the commandId returned from run_command.",
        name: "stop_command",
        parameters: modelToolParameters(stopCommandArgumentsSchema),
      },
      {
        description:
          "List one level of files and directories inside the current authorized workspace. Paths are workspace-relative POSIX paths.",
        name: "list_directory",
        parameters: modelToolParameters(listDirectoryArgumentsSchema)
      },
      {
        description:
          "Read a UTF-8 text file inside the current authorized workspace, optionally selecting a line range.",
        name: "read_file",
        parameters: modelToolParameters(readFileArgumentsSchema)
      },
      {
        description:
          "Search text inside the current authorized workspace with bundled ripgrep. Supports literal or regex matching, smart/sensitive/insensitive case handling, and include/exclude globs. maxResults bounds returned matches. Returns bounded structured matches while respecting project ignore files. Use run_command with rg directly when exact CLI output, context lines, counts, several expressions, or shell pipelines are more suitable.",
        name: "search_text",
        parameters: modelToolParameters(searchTextArgumentsSchema)
      },
      {
        description:
          "Find files with ripgrep by a glob pattern such as **/package.json or src/**/*.ts. maxResults bounds returned paths. Returns workspace-relative POSIX paths while respecting project ignore files.",
        name: "find_files",
        parameters: modelToolParameters(findFilesArgumentsSchema)
      },
      {
        description:
          "Use this tool, not apply_patch, to create any new UTF-8 text file. It can replace an existing file only when overwrite=true; read it first when changing existing content. This produces a reviewable diff before writing.",
        name: "write_file",
        parameters: modelToolParameters(writeFileArgumentsSchema)
      },
      {
        description:
          "Propose deleting one existing UTF-8 text file. Read it first so the deletion has a reviewable diff and requires the configured write approval.",
        name: "delete_file",
        parameters: modelToolParameters(deleteFileArgumentsSchema)
      },
      {
        description:
          "Propose an exact text replacement in a UTF-8 project file. The original text must match exactly expectedReplacements times, so use read_file first.",
        name: "replace_in_file",
        parameters: modelToolParameters(replaceInFileArgumentsSchema)
      },
      {
        description:
          "Modify exactly one existing UTF-8 file with a standard unified diff. The patch must start with --- a/path and +++ b/path headers and apply cleanly. Never use Codex-style *** Begin Patch, *** Add File, *** Update File, or *** End Patch markers. Use write_file for new files and delete_file for deletions.",
        name: "apply_patch",
        parameters: modelToolParameters(applyPatchArgumentsSchema)
      },
      {
        description:
          `Run one non-interactive ${commandEnvironment} command in the current authorized workspace root. The bundled rg command is always available. Short commands return normally; a command still running after yieldTimeMs returns a commandId for wait_for_commands. timeoutMs is the command's execution limit; yieldTimeMs only controls when a still-running command is handed back. Set parallel=true only for independent commands intentionally started together. The command is subject to the conversation permission mode and may require user approval before execution.`,
        name: "run_command",
        parameters: modelToolParameters(runCommandArgumentsSchema)
      }
    ];
  }

  public getCommandEnvironmentDescription(): string {
    const configuration = this.terminalConfiguration.getConfiguration();
    const terminal = this.createTerminalLaunch(configuration, "");
    return `${terminal.displayName}（输出解码：${terminalOutputEncodingLabel(
      configuration.outputEncoding,
    )}）`;
  }

  public async execute(
    name: string,
    rawArguments: string,
    projectId: string,
    signal: AbortSignal,
    owner: ProjectOperationOwner = unknownOperationOwner(),
  ): Promise<ToolExecution> {
    try {
      throwIfAborted(signal);
      const parsedArguments = parseToolArguments(rawArguments);
      if (name === "list_project_operations") {
        listProjectOperationsArgumentsSchema.parse(parsedArguments);
        return this.success({ operations: this.listActiveProjectOperations(projectId, owner) });
      }
      if (name === "wait_for_project_operation") {
        const input = waitForProjectOperationArgumentsSchema.parse(parsedArguments);
        return await this.waitForProjectOperation(input.operationId, projectId, input.timeoutMs, signal);
      }
      if (name === "wait_for_commands") {
        const input = waitForCommandsArgumentsSchema.parse(parsedArguments);
        return await this.waitForCommands(input, projectId, signal);
      }
      if (name === "stop_command") {
        const input = stopCommandArgumentsSchema.parse(parsedArguments);
        return this.stopCommand(input.commandId, projectId);
      }
      if (name === "list_directory") {
        const input = listDirectoryArgumentsSchema.parse(parsedArguments);
        const listing = await this.projects.listEntries({
          directoryPath: input.path,
          projectId
        });
        return this.success(listing);
      }
      if (name === "read_file") {
        return await this.readProjectFile(parsedArguments, projectId, signal);
      }
      if (name === "search_text") {
        return await this.searchProject(parsedArguments, projectId, signal);
      }
      if (name === "find_files") {
        return await this.findProjectFiles(parsedArguments, projectId, signal);
      }
      if (name === "write_file") {
        return await this.prepareWriteFile(parsedArguments, projectId, signal);
      }
      if (name === "delete_file") {
        return await this.prepareDeleteFile(parsedArguments, projectId, signal);
      }
      if (name === "replace_in_file") {
        return await this.prepareReplaceInFile(parsedArguments, projectId, signal);
      }
      if (name === "apply_patch") {
        return await this.preparePatch(parsedArguments, projectId, signal);
      }
      if (name === "run_command") {
        return this.prepareCommand(parsedArguments);
      }
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        kind: "completed",
        content: toolErrorContent(error, `tool:${name}`),
        isError: true
      };
    }
  }

  private async readProjectFile(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecutionResult> {
    const input = readFileArgumentsSchema.parse(rawArguments);
    const filePath = await this.projects.resolveProjectPath(projectId, input.path);
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Requested path is not a file.");
    if (fileInfo.size > MAX_READ_FILE_BYTES) {
      throw new Error("Requested file exceeds the read size limit.");
    }
    throwIfAborted(signal);
    const contents = await readFile(filePath, "utf8");
    if (contents.includes("\u0000")) throw new Error("Requested file is not UTF-8 text.");
    const lines = contents.split(/\r?\n/);
    const startIndex = input.startLine - 1;
    const endIndex = Math.min(
      input.endLine ?? input.startLine + MAX_READ_LINES - 1,
      lines.length
    );
    return this.success({
      content: lines.slice(startIndex, endIndex).join("\n"),
      endLine: endIndex,
      path: input.path,
      startLine: input.startLine,
      totalLines: lines.length
    });
  }

  private async searchProject(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecutionResult> {
    const input = searchTextArgumentsSchema.parse(rawArguments);
    const project = this.projects.getProject(projectId);
    const searchRoot = await this.projects.resolveProjectPath(projectId, input.path);
    const rootInfo = await stat(searchRoot);
    if (!rootInfo.isDirectory()) throw new Error("Search path is not a directory.");
    const result = await searchTextWithRipgrep({
      caseMode: input.caseMode,
      excludeGlobs: input.excludeGlobs,
      includeGlobs: input.includeGlobs,
      maxResults: input.maxResults,
      mode: input.mode,
      path: input.path,
      projectRoot: project.rootPath,
      query: input.query,
      signal,
    });
    return this.success({
      ...result,
      caseMode: input.caseMode,
      excludeGlobs: input.excludeGlobs,
      includeGlobs: input.includeGlobs,
      mode: input.mode,
      query: input.query,
      searchPath: input.path,
    });
  }

  private async findProjectFiles(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecutionResult> {
    const input = findFilesArgumentsSchema.parse(rawArguments);
    const project = this.projects.getProject(projectId);
    const searchRoot = await this.projects.resolveProjectPath(projectId, input.path);
    const rootInfo = await stat(searchRoot);
    if (!rootInfo.isDirectory()) throw new Error("Search path is not a directory.");

    const result = await findFilesWithRipgrep({
      maxResults: input.maxResults,
      path: input.path,
      pattern: input.pattern,
      projectRoot: project.rootPath,
      signal,
    });
    return this.success({
      ...result,
      pattern: input.pattern,
      searchPath: input.path,
    });
  }

  public async applyPreparedChange(
    change: PreparedFileChange,
    projectId: string,
    signal: AbortSignal,
    owner: ProjectOperationOwner = unknownOperationOwner(),
  ): Promise<ToolExecutionResult> {
    const filePath = await this.projects.resolveWritableProjectPath(projectId, change.path);
    try {
      return await this.runProjectMutation(
        projectId,
        { kind: "file", path: change.path },
        owner,
        signal,
        async () => {
      const existing = await this.readEditableFile(filePath, true);
      if (existing !== change.expectedContent) {
        throw new Error(
          "The file changed after the diff was generated. Read it again and prepare a new change."
        );
      }
      if (change.expectedContent === null && existing !== null) {
        throw new Error("The target file was created after the diff was generated.");
      }
      if (change.content === null) {
        await unlink(filePath);
        return this.success({
          operation: change.operation,
          path: change.path,
          status: "applied"
        });
      }
      const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.agent-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
      );
      try {
        await writeFile(temporaryPath, change.content, "utf8");
        throwIfAborted(signal);
        await rename(temporaryPath, filePath);
      } finally {
        // `rename` removes the temporary name. A cancelled write may leave no file here.
        await this.removeTemporaryFile(temporaryPath);
      }
      return this.success({
        operation: change.operation,
        path: change.path,
        status: "applied"
      });
        },
      );
    } catch (error) {
      if (error instanceof ProjectOperationConflictError) {
        return this.operationConflict(error.conflict);
      }
      throw error;
    }
  }

  public async executePreparedCommand(
    command: PreparedCommand,
    projectId: string,
    signal: AbortSignal,
    owner: ProjectOperationOwner = unknownOperationOwner(),
  ): Promise<ToolExecutionResult> {
    const configuration = this.terminalConfiguration.getConfiguration();
    const terminal = this.createTerminalLaunch(configuration, command.command);
    let session: CommandSession | undefined;
    try {
      const operation = this.runProjectMutation(
        projectId,
        { command: command.command, kind: "command", parallel: command.parallel },
        owner,
        signal,
        async (commandId) => {
          const project = this.projects.getProject(projectId);
          session = this.startCommand(
            commandId,
            command,
            project.id,
            project.rootPath,
            signal,
            configuration.outputEncoding,
            terminal,
          );
          this.commandSessions.set(commandId, session);
          await session.completion;
          return session;
        },
      );
      const settled = operation.then(
        (value) => ({ kind: "settled" as const, value }),
        (error: unknown) => ({ error, kind: "failed" as const }),
      );
      const outcome = command.yieldTimeMs === 0
        ? await Promise.race([
            settled,
            Promise.resolve({ kind: "yielded" as const }),
          ])
        : await Promise.race([
            settled,
            waitForDelay(command.yieldTimeMs).then(() => ({ kind: "yielded" as const })),
          ]);
      if (outcome.kind === "failed") throw outcome.error;
      if (outcome.kind === "settled") return this.commandExecutionResult(outcome.value);
      if (session === undefined) {
        const started = await settled;
        if (started.kind === "failed") throw started.error;
        return this.commandExecutionResult(started.value);
      }
      return this.commandExecutionResult(session);
    } catch (error) {
      if (error instanceof ProjectOperationConflictError) {
        return this.operationConflict(error.conflict);
      }
      throw error;
    }
  }

  private async prepareWriteFile(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecution> {
    const input = writeFileArgumentsSchema.parse(rawArguments);
    const filePath = await this.projects.resolveWritableProjectPath(projectId, input.path);
    const current = await this.readEditableFile(filePath, true);
    if (current !== null && !input.overwrite) {
      throw new Error("The target file already exists. Read it and use replace_in_file or set overwrite.");
    }
    throwIfAborted(signal);
    return this.change({
      content: input.content,
      expectedContent: current,
      operation: "write_file",
      path: input.path
    });
  }

  private async prepareReplaceInFile(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecution> {
    const input = replaceInFileArgumentsSchema.parse(rawArguments);
    const filePath = await this.projects.resolveProjectPath(projectId, input.path);
    const current = await this.readEditableFile(filePath, false);
    if (current === null) throw new Error("The target file does not exist.");
    const occurrences = current.split(input.oldText).length - 1;
    if (occurrences !== input.expectedReplacements) {
      throw new Error(
        `Expected ${input.expectedReplacements} exact matches, found ${occurrences}. Read the file and retry.`
      );
    }
    throwIfAborted(signal);
    return this.change({
      content: current.replaceAll(input.oldText, input.newText),
      expectedContent: current,
      operation: "replace_in_file",
      path: input.path
    });
  }

  private async prepareDeleteFile(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecution> {
    const input = deleteFileArgumentsSchema.parse(rawArguments);
    const filePath = await this.projects.resolveProjectPath(projectId, input.path);
    const current = await this.readEditableFile(filePath, false);
    if (current === null) throw new Error("The target file does not exist.");
    throwIfAborted(signal);
    return this.change({
      content: null,
      expectedContent: current,
      operation: "delete_file",
      path: input.path
    });
  }

  private async preparePatch(
    rawArguments: unknown,
    projectId: string,
    signal: AbortSignal
  ): Promise<ToolExecution> {
    const input = applyPatchArgumentsSchema.parse(rawArguments);
    if (/^\*\*\* (?:Begin Patch|Add File:|Update File:|Delete File:|End Patch)/mu.test(input.patch)) {
      throw new Error(
        "apply_patch 仅接受以 --- 和 +++ 文件头开头的标准 unified diff；新建文件请使用 write_file，删除文件请使用 delete_file。"
      );
    }
    const patches = parsePatch(input.patch);
    if (patches.length !== 1) {
      throw new Error("apply_patch 每次只能修改一个已存在文件，并且补丁必须包含 --- 和 +++ 文件头。");
    }
    const patch = patches[0];
    if (patch === undefined || patch.oldFileName === "/dev/null" || patch.newFileName === "/dev/null") {
      throw new Error("新建文件请使用 write_file，删除文件请使用 delete_file。");
    }
    const patchFileName = patch.newFileName ?? patch.oldFileName;
    if (patchFileName === undefined) {
      throw new Error("补丁中缺少目标文件路径；请提供 --- 和 +++ 文件头。");
    }
    const patchPath = this.toProjectRelativePatchPath(patchFileName);
    const filePath = await this.projects.resolveProjectPath(projectId, patchPath);
    const current = await this.readEditableFile(filePath, false);
    if (current === null) throw new Error("补丁目标文件不存在；新建文件请使用 write_file。");
    const next = applyPatch(current, input.patch);
    if (next === false) {
      throw new Error("补丁无法应用到当前文件；请重新读取文件后生成新补丁。");
    }
    throwIfAborted(signal);
    return this.change({
      content: next,
      expectedContent: current,
      operation: "apply_patch",
      path: patchPath
    });
  }

  private prepareCommand(rawArguments: unknown): ToolExecution {
    const input = runCommandArgumentsSchema.parse(rawArguments);
    return {
      command: input,
      content: JSON.stringify({
        ok: true,
        value: { command: input.command, status: "awaiting_approval", timeoutMs: input.timeoutMs }
      }),
      isError: false,
      kind: "command"
    };
  }

  private createTerminalLaunch(
    configuration: TerminalConfiguration,
    command: string,
  ): TerminalLaunch {
    const shell = this.resolveTerminalShell(configuration.shell);

    switch (shell) {
      case "powershell":
        return {
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
          ],
          displayName: process.platform === "win32" ? "Windows PowerShell" : "PowerShell",
          executable: process.platform === "win32" ? "powershell.exe" : "pwsh",
          shell,
        };
      case "pwsh":
        return {
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
          displayName: "PowerShell 7",
          executable: process.platform === "win32" ? "pwsh.exe" : "pwsh",
          shell,
        };
      case "cmd":
        if (process.platform !== "win32") {
          throw new Error("命令提示符仅在 Windows 上可用。");
        }
        return {
          args: ["/d", "/s", "/c", command],
          displayName: "命令提示符",
          executable: "cmd.exe",
          shell,
        };
      case "bash":
        if (process.platform === "win32") {
          throw new Error("Windows 上暂不支持直接以 Bash 运行项目命令。");
        }
        return {
          args: ["--noprofile", "--norc", "-lc", command],
          displayName: "Bash",
          executable: "bash",
          shell,
        };
    }
  }

  private resolveTerminalShell(shell: TerminalShell): ResolvedTerminalShell {
    if (shell !== "system") return shell;
    return process.platform === "win32" ? "powershell" : "pwsh";
  }

  private startCommand(
    commandId: string,
    command: PreparedCommand,
    projectId: string,
    workingDirectory: string,
    signal: AbortSignal,
    outputEncoding: TerminalOutputEncoding,
    terminal: TerminalLaunch,
  ): CommandSession {
    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const child = spawn(
      terminal.executable,
      terminal.args,
      {
        cwd: workingDirectory,
        env: commandEnvironmentWithBundledRipgrep(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const session: CommandSession = {
      command: command.command,
      commandId,
      completedAt: null,
      completion,
      error: null,
      exitCode: null,
      outputEncoding,
      projectId,
      startedAt: new Date().toISOString(),
      status: "running",
      stderrByteLength: 0,
      stderrChunks: [],
      stdoutByteLength: 0,
      stdoutChunks: [],
      terminal,
      terminate: (cancelled) => {
        if (session.status !== "running" || child.pid === undefined) return;
        if (cancelled) session.status = "cancelled";
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            windowsHide: true,
          }).once("error", () => child.kill());
          return;
        }
        child.kill("SIGTERM");
      },
      timedOut: false,
      truncated: false,
      workingDirectory,
    };
    const appendOutput = (target: "stderr" | "stdout", chunk: Buffer): void => {
      const byteLengthKey = target === "stderr" ? "stderrByteLength" : "stdoutByteLength";
      const chunks = target === "stderr" ? session.stderrChunks : session.stdoutChunks;
      const remaining = MAX_COMMAND_OUTPUT_LENGTH - session[byteLengthKey];
      if (remaining <= 0) {
        session.truncated = true;
        return;
      }
      const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(accepted);
      session[byteLengthKey] += accepted.length;
      if (accepted.length < chunk.length) session.truncated = true;
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (
      status: Exclude<CommandSessionStatus, "running">,
      exitCode: number | null,
      error: string | null,
    ): void => {
      if (session.completedAt !== null) return;
      cleanup();
      session.completedAt = new Date().toISOString();
      session.error = error;
      session.exitCode = exitCode;
      session.status = session.status === "cancelled" ? "cancelled" : status;
      resolveCompletion();
    };
    const onAbort = (): void => session.terminate(true);

    const timer = setTimeout(() => {
      session.timedOut = true;
      session.terminate(false);
    }, command.timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));
    child.once("error", (error) => {
      finish("failed", null, `无法启动 ${terminal.displayName}：${error.message}`);
    });
    child.once("close", (exitCode) => {
      finish(
        exitCode === 0 && !session.timedOut ? "completed" : "failed",
        exitCode,
        null,
      );
    });
    if (signal.aborted) session.terminate(true);
    return session;
  }

  private commandExecutionResult(session: CommandSession): ToolExecutionResult {
    const value = this.commandSessionSnapshot(session);
    if (session.status === "running" || session.status === "completed") {
      return this.success(value);
    }
    return {
      content: JSON.stringify({ ok: false, value }),
      isError: true,
      kind: "completed",
    };
  }

  private commandSessionSnapshot(session: CommandSession): unknown {
    return {
      command: session.command,
      commandId: session.commandId,
      completedAt: session.completedAt,
      error: session.error,
      exitCode: session.exitCode,
      startedAt: session.startedAt,
      status: session.status,
      stderr: decodeTerminalOutput(Buffer.concat(session.stderrChunks), session.outputEncoding),
      stdout: decodeTerminalOutput(Buffer.concat(session.stdoutChunks), session.outputEncoding),
      terminal: {
        displayName: session.terminal.displayName,
        outputEncoding: session.outputEncoding,
        shell: session.terminal.shell,
      },
      timedOut: session.timedOut,
      truncated: session.truncated,
      workingDirectory: session.workingDirectory,
    };
  }

  private async waitForCommands(
    input: z.infer<typeof waitForCommandsArgumentsSchema>,
    projectId: string,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const commandIds = [...new Set(input.commandIds)];
    const sessions = commandIds.map((commandId) => {
      const session = this.commandSessions.get(commandId);
      if (session === undefined || session.projectId !== projectId) {
        throw new Error(`Command ${commandId} was not found in the current project.`);
      }
      return session;
    });
    const isReady = (): boolean => input.waitFor === "all"
      ? sessions.every((session) => session.completedAt !== null)
      : sessions.some((session) => session.completedAt !== null);
    const waitStatus = isReady()
      ? "finished"
      : await waitForBoundedCompletion(
          input.waitFor === "all"
            ? Promise.all(sessions.map((session) => session.completion)).then(() => undefined)
            : Promise.race(sessions.map((session) => session.completion)),
          input.timeoutMs,
          signal,
        );
    return this.success({
      commands: sessions.map((session) => this.commandSessionSnapshot(session)),
      waitStatus,
    });
  }

  private stopCommand(commandId: string, projectId: string): ToolExecutionResult {
    const session = this.commandSessions.get(commandId);
    if (session === undefined || session.projectId !== projectId) {
      throw new Error("Command was not found in the current project.");
    }
    session.terminate(true);
    return this.success({ command: this.commandSessionSnapshot(session) });
  }

  private async readEditableFile(
    filePath: string,
    allowMissing: boolean
  ): Promise<string | null> {
    try {
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) throw new Error("Requested path is not a file.");
      if (fileInfo.size > MAX_EDIT_FILE_BYTES) {
        throw new Error("Requested file exceeds the edit size limit.");
      }
      const contents = await readFile(filePath, "utf8");
      if (contents.includes("\u0000")) throw new Error("Requested file is not UTF-8 text.");
      return contents;
    } catch (error) {
      if (
        allowMissing &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  private change(input: Omit<PreparedFileChange, "diff">): ToolExecution {
    return {
      change: {
        ...input,
        diff: createTwoFilesPatch(
          input.path,
          input.path,
          input.expectedContent ?? "",
          input.content ?? ""
        )
      },
      content: JSON.stringify({ ok: true, value: { path: input.path, status: "awaiting_approval" } }),
      isError: false,
      kind: "change"
    };
  }

  private toProjectRelativePatchPath(fileName: string): string {
    const normalized = fileName.replace(/^[ab]\//, "");
    return relativeProjectPathSchema
      .refine((value) => value.length > 0, { message: "Patch file path is required." })
      .parse(normalized);
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  private async runProjectMutation<T>(
    projectId: string,
    scope: ProjectOperationScope,
    owner: ProjectOperationOwner,
    signal: AbortSignal,
    operation: (operationId: string) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    const conflict = [...this.projectOperations.values()].find((candidate) =>
      candidate.projectId === projectId
      && candidate.status === "active"
      && scopesConflict(candidate.scope, scope)
      && !commandsCanRunInParallel(candidate, scope, owner)
    );
    if (conflict !== undefined) throw new ProjectOperationConflictError(conflict);

    let completeOperation: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      completeOperation = resolve;
    });
    const record: ProjectOperationRecord = {
      ...owner,
      completedAt: null,
      completion,
      operationId: randomUUID(),
      projectId,
      scope,
      startedAt: new Date().toISOString(),
      status: "active",
    };
    this.projectOperations.set(record.operationId, record);

    try {
      throwIfAborted(signal);
      const result = await operation(record.operationId);
      record.status = "completed";
      return result;
    } catch (error) {
      record.status = "failed";
      throw error;
    } finally {
      record.completedAt = new Date().toISOString();
      completeOperation?.();
      this.pruneCompletedOperations();
    }
  }

  private listActiveProjectOperations(
    projectId: string,
    owner: ProjectOperationOwner,
  ): unknown[] {
    return [...this.projectOperations.values()]
      .filter((operation) =>
        operation.projectId === projectId
        && operation.status === "active"
        && operation.conversationId !== owner.conversationId
      )
      .map(publicProjectOperation);
  }

  private async waitForProjectOperation(
    operationId: string,
    projectId: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const operation = this.projectOperations.get(operationId);
    if (operation === undefined || operation.projectId !== projectId) {
      throw new Error("Project operation was not found or is no longer available.");
    }
    if (operation.status !== "active") {
      return this.success({ operation: publicProjectOperation(operation), waitStatus: "finished" });
    }
    const waitStatus = await new Promise<"finished" | "timeout">((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve("timeout");
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void operation.completion.then(() => {
        cleanup();
        resolve("finished");
      });
    });
    return this.success({ operation: publicProjectOperation(operation), waitStatus });
  }

  private operationConflict(conflict: ProjectOperationRecord): ToolExecutionResult {
    return {
      content: JSON.stringify({
        code: "PROJECT_OPERATION_CONFLICT",
        error: `项目当前正由对话“${conflict.conversationTitle}”执行冲突操作。`,
        ok: false,
        value: {
          conflict: publicProjectOperation(conflict),
          nextActions: [
            "调用 wait_for_project_operation 等待操作完成",
            "调用 send_agent_message 联系占用该操作的对话",
          ],
        },
      }),
      isError: true,
      kind: "completed",
    };
  }

  private pruneCompletedOperations(): void {
    const completed = [...this.projectOperations.values()]
      .filter((operation) => operation.status !== "active")
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    for (const operation of completed.slice(0, Math.max(0, completed.length - 100))) {
      this.projectOperations.delete(operation.operationId);
      this.commandSessions.delete(operation.operationId);
    }
  }

  private success(value: unknown): ToolExecutionResult {
    return { kind: "completed", content: JSON.stringify({ ok: true, value }), isError: false };
  }
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function commandEnvironmentWithBundledRipgrep(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const nextEnvironment = { ...environment };
  const pathKey = Object.keys(nextEnvironment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = nextEnvironment[pathKey] ?? "";
  const ripgrepDirectory = path.dirname(rgPath);
  const pathEntries = currentPath.split(path.delimiter).filter((entry) => entry.length > 0);
  const alreadyAvailable = pathEntries.some((entry) =>
    process.platform === "win32"
      ? entry.toLowerCase() === ripgrepDirectory.toLowerCase()
      : entry === ripgrepDirectory
  );
  nextEnvironment[pathKey] = alreadyAvailable
    ? currentPath
    : [ripgrepDirectory, currentPath].filter((entry) => entry.length > 0).join(path.delimiter);
  return nextEnvironment;
}

function waitForBoundedCompletion(
  completion: Promise<void>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<"finished" | "timeout"> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    void completion.then(() => {
      cleanup();
      resolve("finished");
    });
  });
}

function scopesConflict(left: ProjectOperationScope, right: ProjectOperationScope): boolean {
  return left.kind === "command"
    || right.kind === "command"
    || left.path === right.path;
}

function commandsCanRunInParallel(
  active: ProjectOperationRecord,
  next: ProjectOperationScope,
  owner: ProjectOperationOwner,
): boolean {
  return active.runId === owner.runId
    && active.scope.kind === "command"
    && next.kind === "command"
    && active.scope.parallel
    && next.parallel;
}

function publicProjectOperation(operation: ProjectOperationRecord): unknown {
  return {
    completedAt: operation.completedAt,
    conversationId: operation.conversationId,
    conversationTitle: operation.conversationTitle,
    operationId: operation.operationId,
    runId: operation.runId,
    scope: operation.scope,
    startedAt: operation.startedAt,
    status: operation.status,
  };
}

function unknownOperationOwner(): ProjectOperationOwner {
  return {
    conversationId: "unknown",
    conversationTitle: "未知对话",
    runId: "unknown",
  };
}

export function decodeTerminalOutput(
  output: Buffer,
  encoding: TerminalOutputEncoding,
): string {
  if (encoding !== "auto") {
    return new TextDecoder(encoding).decode(output);
  }

  let decoded = "";
  let lineStart = 0;

  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0x0a) continue;
    decoded += decodeAutoTerminalLine(output.subarray(lineStart, index + 1));
    lineStart = index + 1;
  }

  return `${decoded}${decodeAutoTerminalLine(output.subarray(lineStart))}`;
}

function decodeAutoTerminalLine(output: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return new TextDecoder("gb18030").decode(output);
  }
}

function terminalOutputEncodingLabel(encoding: TerminalOutputEncoding): string {
  switch (encoding) {
    case "auto":
      return "自动（UTF-8/GB18030）";
    case "utf-8":
      return "UTF-8";
    case "gbk":
      return "GBK";
    case "gb18030":
      return "GB18030";
    case "utf-16le":
      return "UTF-16 LE";
  }
}
