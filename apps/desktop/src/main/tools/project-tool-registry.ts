import type { BackgroundCommand, BackgroundCommandOutput } from "@agent/protocol";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  APPLICATION_DISPLAY_NAME,
  projectFileSchema,
  relativeProjectPathSchema,
  type AgentPermissionTool,
  type ProjectFile,
  type WriteProjectFileInput,
} from "@agent/protocol";
import { applyPatch, createTwoFilesPatch, parsePatch } from "diff";
import { z } from "zod";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments, ToolArgumentsError } from "../model/tool-arguments.js";
import { toolErrorContent } from "../errors/tool-error.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { parseCodexUpdatePatch } from "./codex-update-patch.js";
import { findFilesWithRipgrep, searchTextWithRipgrep } from "./ripgrep-search.js";
import { readTextLines } from "./read-text-lines.js";
import type { ToolExecutionPolicy } from "./tool-execution-policy.js";
import { CommandSessionRunner, DEFAULT_TERMINAL_CONFIGURATION_PROVIDER, type PreparedCommand, type CommandOutputListener, type TerminalConfigurationProvider } from "./command-session-runner.js";
import type { ToolExecutionResult } from "./tool-execution-result.js";

export { commandEnvironmentWithBundledRipgrep, decodeTerminalOutput, type PreparedCommand, type CommandOutputEvent, type CommandOutputListener } from "./command-session-runner.js";
export type { ToolExecutionResult } from "./tool-execution-result.js";

const MAX_READ_FILE_BYTES = 250_000;
// A full replacement can contain both the old and new text in the persisted diff.
const MAX_EDIT_FILE_BYTES = 200_000;
const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_READ_LINES = 400;
const MAX_FIND_RESULTS = 500;
const MAX_COMMAND_LENGTH = 4_000;
const MAX_COMMAND_TIMEOUT_MS = 30 * 60_000;
const MAX_COMMAND_WAIT_MS = 10 * 60_000;
const MAX_COMMAND_YIELD_MS = 30_000;
const MAX_SERVICE_NAME_LENGTH = 120;

const PARALLEL_READ_TOOL_NAMES = new Set([
  "list_project_operations",
  "list_background_commands",
  "read_command_output",
  "read_file",
  "view_image",
  "search_text",
  "find_files",
]);

const COMMAND_TOOL_NAMES = new Set([
  "list_background_commands",
  "read_command_output",
  "run_command",
  "wait_for_commands",
  "stop_command",
]);

const viewImageArgumentsSchema = z.object({
  path: relativeProjectPathSchema.refine((value) => /\.(png|jpe?g|webp|gif)$/iu.test(value),
    "Use a workspace-relative PNG, JPEG, WebP or GIF image path.")
    .refine((value) => !/[?#]/u.test(value), "Image paths containing URL query or fragment delimiters are unsupported.")
    .describe("Image file path relative to the current workspace, not a URL or absolute path."),
}).strict();

const PREPARE_BEFORE_BATCH_TOOL_NAMES = new Set([
  "write_file",
  "delete_file",
  "replace_in_file",
  "apply_patch",
]);

const readFileArgumentsSchema = z
  .object({
    path: relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A file path is required."
    }).describe("Project-relative POSIX file path."),
    startLine: z.number().int().positive().default(1)
      .describe("One-based first line to return. Defaults to 1; use nextStartLine from a previous result to continue."),
    lineCount: z.number().int().min(1).max(MAX_READ_LINES).nullish().transform((value) => value ?? undefined)
      .describe(`Preferred limit: NUMBER OF LINES (1-${MAX_READ_LINES}), not an end line. Example: startLine=650, lineCount=220 reads lines 650-869. Omit or set null when using endLine. If both are supplied they must describe the same range; if neither is supplied read up to ${MAX_READ_LINES} lines.`),
    endLine: z.number().int().positive().nullish().transform((value) => value ?? undefined)
      .describe(`Alternative limit: one-based inclusive END LINE NUMBER. Example: startLine=650, endLine=869. Must be >= startLine and select at most ${MAX_READ_LINES} lines. Omit or set null when using lineCount. If both are supplied, endLine must equal startLine+lineCount-1.`),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lineCount !== undefined && value.endLine !== undefined
      && value.endLine !== value.startLine + value.lineCount - 1) {
      context.addIssue({
        code: "custom",
        message: "Choose either lineCount or endLine, not both. Remove endLine to read a number of lines, or remove lineCount to read through an inclusive end line.",
        path: ["endLine"],
      });
      return;
    }
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
      message: `endLine is an absolute line number, not a count; it must be >= startLine (${value.startLine}). If ${value.endLine} means how many lines to read, replace endLine with lineCount (1-${MAX_READ_LINES}) and keep startLine.`,
      path: ["endLine"],
    });
  });

const externalReadFileArgumentsSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096)
      .refine((value) => path.isAbsolute(value), {
        message: "An absolute file path is required.",
      })
      .describe("Absolute UTF-8 text file path outside the authorized project."),
  })
  .strict();

const searchTextArgumentsSchema = z
  .object({
    caseMode: z.enum(["smart", "sensitive", "insensitive"]).default("smart")
      .describe("Case handling: smart follows query casing; sensitive or insensitive forces the mode."),
    excludeGlobs: z.array(z.string().trim().min(1).max(200)).max(20).default([])
      .describe("Optional ripgrep exclude globs, matched against project-relative paths even when path selects a subdirectory."),
    includeGlobs: z.array(z.string().trim().min(1).max(200)).max(20).default([])
      .describe("Optional ripgrep include globs, matched against project-relative paths even when path selects a subdirectory."),
    maxResults: z.number().int().min(1).max(100).default(50)
      .describe("Maximum number of matching lines to return."),
    mode: z.enum(["literal", "regex"]).default("literal")
      .describe("literal searches exact text; regex interprets query as a regular expression."),
    path: relativeProjectPathSchema.default("")
      .describe("Project-relative POSIX file or directory path, e.g. src/main.ts or src. Empty searches the project root. A file path searches only that file."),
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
      .describe("Ripgrep glob relative to path, not the project root when path is set. Example: path=src-tauri, pattern=icons/icon.ico. With an empty path, use **/package.json or src/**/*.ts. Brace alternatives must be closed, e.g. {README.md,package.json}.")
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
      .describe("Single existing-file patch: standard ---/+++ unified diff, or Begin Patch / Update File / @@ / End Patch with exact source context."),
  })
  .strict();

const runCommandArgumentsSchema = z
  .object({
    command: z.string().trim().min(1).max(MAX_COMMAND_LENGTH)
      .describe("One non-interactive command for the configured project shell."),
    description: z.string().trim().max(200).optional()
      .describe("Recommended short user-facing purpose in the response language: action + actual target + important conditions. Examples: ping -n 4 www.baidu.com => 'Ping Baidu to check network connectivity and latency'; mvn -pl order-service -am package -DskipTests => 'Package order-service with Maven (skip tests)'; java -jar target/order-service.jar with mode=service => 'Start order-service in the background'. Use targets from this task; describe intent, not unverified success. Optional; omission or an empty value uses the command as the display title."),
    mode: z.enum(["batch", "service"]).default("batch")
      .describe("batch is a finite command such as a build or test; service is intentionally persistent. Both may return while running after yieldTimeMs."),
    parallel: z.boolean().default(true)
      .describe("Run alongside other independent commands from the same model turn by default; set false when this command depends on another command or shared mutable state."),
    timeoutMs: z.number().int().min(1_000).max(MAX_COMMAND_TIMEOUT_MS).nullable().optional()
      .describe("Execution safety limit in milliseconds, not the requested task duration. Omit for batch's 30-minute default or service's unlimited lifetime; null explicitly disables the limit for long builds. A finite command must still exit by itself."),
    serviceName: z.string().trim().min(1).max(MAX_SERVICE_NAME_LENGTH).optional()
      .describe("Human-readable name for a service command, such as Vite development server."),
    yieldTimeMs: z.number().int().min(0).max(MAX_COMMAND_YIELD_MS).default(10_000)
      .describe("Observation window for either mode (0-30000 ms). Return final output if the process exits sooner; otherwise return running with commandId. This never limits the process lifetime."),
  })
  .strict();

const listBackgroundCommandsArgumentsSchema = z.object({}).strict();

const readCommandOutputArgumentsSchema = z.object({
  commandId: z.string().uuid().describe("Command UUID returned by run_command or list_background_commands in this conversation."),
  stdoutOffset: z.number().int().min(0).default(0).describe("Character offset from nextStdoutOffset in the previous read; omit to read from the beginning of retained stdout."),
  stderrOffset: z.number().int().min(0).default(0).describe("Character offset from nextStderrOffset in the previous read; omit to read from the beginning of retained stderr."),
  maxChars: z.number().int().min(1).max(32_000).default(12_000).describe("Maximum characters returned per output stream. Retained logs are bounded; truncated reports the retention limit."),
  yieldTimeMs: z.number().int().min(0).max(MAX_COMMAND_YIELD_MS).default(10_000).describe("If still running, observe for up to this many milliseconds or until exit. Use 0 for an immediate snapshot. Does not stop the command."),
}).strict();

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

export type PreparedFileChange = {
  content: string | null;
  diff: string;
  expectedContent: string | null;
  operation: "apply_patch" | "delete_file" | "replace_in_file" | "write_file";
  path: string;
};

export type PreparedExternalFileRead = {
  canonicalPath: string;
  path: string;
  sizeBytes: number;
};

export type PreparedApprovedAction = {
  execute(): Promise<ToolExecutionResult>;
  pattern: string;
  permissionTool: AgentPermissionTool;
  rejectionMessage: string;
  rejectionValue?: Record<string, unknown>;
};

export type ProjectOperationOwner = {
  conversationId: string;
  conversationTitle: string;
  runId: string;
};

type ProjectOperationScope =
  | { kind: "command"; command: string; parallel: boolean }
  | { kind: "file"; path: string };

function normalizeModelUnifiedDiff(patch: string): string {
  const lines = patch.split(/\r?\n/u);
  if (lines[0]?.trim() === "*** Begin Patch") lines.shift();

  let lastContentIndex = lines.length - 1;
  while (lastContentIndex >= 0 && lines[lastContentIndex]?.trim().length === 0) {
    lastContentIndex -= 1;
  }
  if (lines[lastContentIndex]?.trim() === "*** End Patch") {
    lines.splice(lastContentIndex, 1);
  }

  const unsupportedDirective = lines.find((line) => (
    /^\*\*\* (?:Add File:|Update File:|Delete File:)/u.test(line.trim())
  ));
  if (unsupportedDirective !== undefined) {
    if (unsupportedDirective.trim().startsWith("*** Add File:")) {
      throw new Error(
        "检测到 GPT/Codex 的 *** Add File: 补丁指令；新建文件请使用 write_file。",
      );
    }
    if (unsupportedDirective.trim().startsWith("*** Delete File:")) {
      throw new Error(
        "检测到 GPT/Codex 的 *** Delete File: 补丁指令；删除文件请使用 delete_file。",
      );
    }
    throw new Error(
      "检测到 GPT/Codex 的 *** Update File: 补丁指令；请保留修改内容并改为标准 ---/+++ diff，或对整段精确替换使用 replace_in_file。",
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]?.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u,
    );
    if (header === null || header === undefined) continue;

    let oldLineCount = 0;
    let newLineCount = 0;
    let bodyIndex = index + 1;
    let hasInvalidBodyLine = false;
    for (; bodyIndex < lines.length; bodyIndex += 1) {
      const line = lines[bodyIndex] ?? "";
      if (line.startsWith("@@ ") || line.startsWith("--- ")) break;
      if (line.startsWith("\\ No newline at end of file")) continue;
      if (line.startsWith(" ")) {
        oldLineCount += 1;
        newLineCount += 1;
        continue;
      }
      if (line.startsWith("-")) {
        oldLineCount += 1;
        continue;
      }
      if (line.startsWith("+")) {
        newLineCount += 1;
        continue;
      }
      hasInvalidBodyLine = true;
      break;
    }

    if (!hasInvalidBodyLine) {
      lines[index] = `@@ -${header[1]},${oldLineCount} +${header[2]},${newLineCount} @@${header[3]}`;
    }
    index = bodyIndex - 1;
  }

  return lines.join("\n");
}

type ProjectOperationRecord = ProjectOperationOwner & {
  completedAt: string | null;
  completion: Promise<void>;
  operationId: string;
  projectId: string | undefined;
  scope: ProjectOperationScope;
  startedAt: string;
  status: "active" | "completed" | "failed";
  workspaceKey: string;
};

class ProjectOperationConflictError extends Error {
  public readonly code = "PROJECT_OPERATION_CONFLICT";

  public constructor(public readonly conflict: ProjectOperationRecord) {
    super(`Project operation conflicts with conversation ${conflict.conversationTitle}.`);
    this.name = "ProjectOperationConflictError";
  }
}

class PreparedFileChangeStaleError extends Error {
  public readonly code = "FILE_CHANGED";

  public constructor(public readonly filePath: string, message = "The file changed after the diff was generated.") {
    super(message);
    this.name = "PreparedFileChangeStaleError";
  }
}

export type ToolExecution =
  | ToolExecutionResult
  | {
      action: PreparedApprovedAction;
      content: string;
      isError: false;
      kind: "approved_action";
    }
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
    }
  | {
      content: string;
      externalRead: PreparedExternalFileRead;
      isError: false;
      kind: "external_read";
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

  private readonly commands: CommandSessionRunner;

  /** Temporary conversations use an isolated command directory instead of a user workspace. */
  private readonly temporaryCommandRoots = new Map<string, Promise<string>>();

  public constructor(
    private readonly projects: ProjectRegistry,
    terminalConfiguration: TerminalConfigurationProvider =
      DEFAULT_TERMINAL_CONFIGURATION_PROVIDER,
  ) {
    this.commands = new CommandSessionRunner(terminalConfiguration);
  }

  public getDefinitions(): ModelToolDefinition[] {
    const commandEnvironment = this.getCommandEnvironmentDescription();

    return [
      {
        description:
          "List project mutations currently owned by other Agent conversations. Use this only to understand a PROJECT_OPERATION_CONFLICT; the conflicting request is already discarded and must not be replayed.",
        name: "list_project_operations",
        parameters: modelToolParameters(listProjectOperationsArgumentsSchema)
      },
      {
        description:
          "Wait for one project operation to finish. Use its operationId from a conflict result when useful, then re-read affected files or otherwise reassess project state before preparing a new request; waiting never revives the discarded request.",
        name: "wait_for_project_operation",
        parameters: modelToolParameters(waitForProjectOperationArgumentsSchema)
      },
      {
        description:
          "List still-running finite commands and background services started by run_command in this conversation. Recover commandIds missing from recent context. Returns metadata without logs; use read_command_output for bounded logs and final status.",
        name: "list_background_commands",
        parameters: modelToolParameters(listBackgroundCommandsArgumentsSchema),
      },
      {
        description: "Read bounded incremental stdout/stderr and current or final status of an existing command in this conversation. Reuse its commandId; never rerun the command just to inspect progress. Pass nextStdoutOffset and nextStderrOffset from the previous read to avoid duplicating logs. A running result is not success: before dependent work or reporting completion, confirm completedAt and exitCode. Logs update the original command card; this read does not launch a process. Prefer useful independent work between reads over repeated immediate polling.",
        name: "read_command_output",
        parameters: modelToolParameters(readCommandOutputArgumentsSchema),
      },
      {
        description: "Stop one running background command by the commandId returned from run_command. Returns a compact status receipt without command output; completedAt=null means process exit is not yet confirmed. If the ID is no longer in recent context, call list_background_commands first instead of guessing or reusing an old ID.",
        name: "stop_command",
        parameters: modelToolParameters(stopCommandArgumentsSchema),
      },
      {
        description:
          "Read a UTF-8 text file inside the authorized workspace. Prefer startLine + lineCount (number of lines); alternatively use startLine + endLine (inclusive line number). Choose only one limit; omit both for up to 400 lines. Large files support partial reads, at most 250000 bytes per range. nextStartLine gives the next page; totalLines is null until EOF. Read a known path directly to verify it: find_files may omit ignored files.",
        name: "read_file",
        parameters: modelToolParameters(readFileArgumentsSchema)
      },
      {
        description:
          "Prepare a read of one absolute UTF-8 text file outside the current workspace. This always requires explicit user approval; the file contents are not read before approval.",
        name: "read_external_file",
        parameters: modelToolParameters(externalReadFileArgumentsSchema)
      },
      {
        description:
          "Search text in a file or directory inside the current authorized workspace with bundled ripgrep. Supports literal or regex matching, smart/sensitive/insensitive case handling, and include/exclude globs. maxResults bounds returned matches. Returns a successful empty result when nothing matches and bounded structured matches otherwise. Directory searches respect project ignore files; an explicit file path targets that file directly. Prefer this over a shell pipeline for ordinary discovery and expected no-match checks. Use run_command with rg directly when exact CLI output, context lines, counts, or several expressions are required.",
        name: "search_text",
        parameters: modelToolParameters(searchTextArgumentsSchema)
      },
      {
        description:
          "Find files with ripgrep. pattern is relative to the selected directory: path=src-tauri and pattern=icons/icon.ico. Results always use workspace-relative POSIX paths. maxResults bounds returned paths. Empty results mean no matches under the glob and ignore rules, not proof that a known file is missing; use read_file on the known path to verify.",
        name: "find_files",
        parameters: modelToolParameters(findFilesArgumentsSchema)
      },
      {
        description:
          "Use this tool, not apply_patch, to create any new UTF-8 text file. Missing parent directories are created only after the file change is approved. It can replace an existing file only when overwrite=true; read it first when changing existing content. This produces a reviewable diff before writing.",
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
          "Preferred editor for one exact change or a whole-section replacement in an existing UTF-8 project file. Read the file first, then pass the unchanged source as oldText and its replacement as newText. oldText must match exactly expectedReplacements times. Use apply_patch only when one file needs several separate localized edits.",
        name: "replace_in_file",
        parameters: modelToolParameters(replaceInFileArgumentsSchema)
      },
      {
        description:
          "Edit exactly one existing UTF-8 file. Accepts standard ---/+++ unified diff or *** Begin Patch / *** Update File: path / @@ hunks / *** End Patch. Prefix unchanged lines with a space, removals with -, additions with +. Update hunks require exact, unique source context; include enough surrounding lines. No multiple files, Move, Add or Delete directives. Read before editing. Prefer replace_in_file for one exact replacement; use write_file for new files and delete_file for deletion. All changes require normal approval and stale-content checks.",
        name: "apply_patch",
        parameters: modelToolParameters(applyPatchArgumentsSchema)
      },
      {
        description:
          `Run one non-interactive ${commandEnvironment} command. This is the default choice for ordinary commands and does not open a visible terminal tab. Use the default mode=batch for every finite command, including long builds, checks, tests, packaging, and migrations: both modes stream progress and return final output if the process exits within yieldTimeMs (default 10 seconds), or return running with commandId while execution continues. A running receipt is not completion: do independent work, then use read_command_output with the same commandId and incremental offsets before dependent steps or final claims. Batch defaults to a 30-minute execution limit; set timeoutMs=null for a build known to need longer. When the user requests a fixed duration, make the command exit normally after that duration (bounded count or deadline); do not use an infinite command plus the tool timeout as a timer. Use mode=service only for a process intentionally expected to stay alive, such as a development server or watcher: output stays in the original command card and the service continues without an automatic timeout unless timeoutMs is explicitly provided. Give service mode a concise serviceName so list_background_commands can recover its ID later. Never use this tool for SSH, a REPL, password prompts, or any command requiring later input; use terminal_control for those interactive PTY sessions. Any nonzero final exit code marks the command failed even when stdout contains useful data, so keep expected-negative probes separate from unrelated checks and prefer search_text/find_files when no match is acceptable. Commands run in the current authorized workspace; conversations without a project use their own persistent ${APPLICATION_DISPLAY_NAME} workspace. The bundled rg command is always available. Independent commands returned in the same model turn run in parallel by default whenever the permission mode allows commands; set parallel=false when this command depends on another command or shared mutable state. In ask-before-changes mode each command still requires its own approval, and approved independent commands can overlap.`,
        name: "run_command",
        parameters: modelToolParameters(runCommandArgumentsSchema)
      }
    ];
  }

  public getCommandDefinitions(): ModelToolDefinition[] {
    return this.getDefinitions().filter((definition) => COMMAND_TOOL_NAMES.has(definition.name));
  }

  public getProjectDefinitions(): ModelToolDefinition[] {
    return this.getDefinitions().filter((definition) => !COMMAND_TOOL_NAMES.has(definition.name));
  }

  public isCommandTool(toolName: string): boolean {
    return COMMAND_TOOL_NAMES.has(toolName);
  }

  public getExecutionPolicy(
    toolName: string,
    rawArguments: string,
    allowParallelCommands: boolean,
  ): ToolExecutionPolicy {
    if (PARALLEL_READ_TOOL_NAMES.has(toolName)) {
      return { group: "read", kind: "parallel" };
    }
    if (PREPARE_BEFORE_BATCH_TOOL_NAMES.has(toolName)) {
      return { kind: "serial", prepareBeforeBatch: true };
    }
    if (toolName === "run_command" && allowParallelCommands) {
      try {
        const input = runCommandArgumentsSchema.parse(parseToolArguments(rawArguments));
        if (input.parallel) return { group: "command", kind: "parallel" };
      } catch {
        // The handler will return the structured argument error during execution.
      }
    }
    if (
      toolName === "list_project_operations"
      || toolName === "read_file"
      || toolName === "search_text"
      || toolName === "find_files"
      || toolName === "run_command"
      || toolName === "wait_for_commands"
      || toolName === "stop_command"
      || toolName === "wait_for_project_operation"
      || toolName === "read_external_file"
      || PREPARE_BEFORE_BATCH_TOOL_NAMES.has(toolName)
    ) {
      return { kind: "serial" };
    }
    throw new Error(`Unknown project tool: ${toolName}`);
  }

  public getCommandEnvironmentDescription(): string {
    return this.commands.getEnvironmentDescription();
  }

  public async execute(
    name: string,
    rawArguments: string,
    projectId: string | undefined,
    signal: AbortSignal,
    owner: ProjectOperationOwner = unknownOperationOwner(),
  ): Promise<ToolExecution> {
    try {
      throwIfAborted(signal);
      const parsedArguments = parseToolArguments(rawArguments);
      if (name === "list_background_commands") {
        listBackgroundCommandsArgumentsSchema.parse(parsedArguments);
        return this.success({
          commands: this.commands.listBackgroundCommands(projectId, owner.conversationId),
        });
      }
      if (name === "list_project_operations") {
        if (projectId === undefined) throw new Error("A workspace is required for project operation inspection.");
        listProjectOperationsArgumentsSchema.parse(parsedArguments);
        return this.success({ operations: this.listActiveProjectOperations(projectId, owner) });
      }
      if (name === "wait_for_project_operation") {
        if (projectId === undefined) throw new Error("A workspace is required for project operation inspection.");
        const input = waitForProjectOperationArgumentsSchema.parse(parsedArguments);
        return await this.waitForProjectOperation(input.operationId, projectId, input.timeoutMs, signal);
      }
      if (name === "wait_for_commands") {
        const input = waitForCommandsArgumentsSchema.parse(parsedArguments);
        return await this.commands.waitForCommands(input, projectId, owner.conversationId, signal);
      }
      if (name === "read_command_output") {
        const input = readCommandOutputArgumentsSchema.parse(parsedArguments);
        return await this.commands.readCommandOutput(input, projectId, owner.conversationId, signal);
      }
      if (name === "stop_command") {
        const input = stopCommandArgumentsSchema.parse(parsedArguments);
        return this.commands.stopCommand(input.commandId, projectId, owner.conversationId);
      }
      if (name === "read_file") {
        if (projectId === undefined) throw new Error("A workspace is required for file inspection.");
        return await this.readProjectFile(parsedArguments, projectId, signal);
      }
      if (name === "view_image") {
        if (projectId === undefined) throw new Error("A workspace is required for image inspection.");
        const input = viewImageArgumentsSchema.parse(parsedArguments);
        const image = await this.projects.readPreviewImage({ projectId, path: path.posix.basename(input.path), sourcePath: input.path });
        throwIfAborted(signal);
        return {
          ...this.success({ image: { projectId, path: input.path, mimeType: image.mimeType } }),
          modelAttachments: [{
            id: randomUUID(), kind: "image", data: image.data, mimeType: image.mimeType,
            name: path.posix.basename(input.path), projectPath: input.path, source: "project",
            readPath: input.path.startsWith("attachments/") ? `./${input.path}` : input.path,
            contextTokens: Math.min(8192, Math.max(1024, Math.ceil(image.data.length * 0.75 / 2048))),
            readState: "full", truncated: false,
          }],
        };
      }
      if (name === "read_external_file") {
        return await this.prepareExternalFileRead(parsedArguments, signal);
      }
      if (name === "search_text") {
        if (projectId === undefined) throw new Error("A workspace is required for project search.");
        return await this.searchProject(parsedArguments, projectId, signal);
      }
      if (name === "find_files") {
        if (projectId === undefined) throw new Error("A workspace is required for file search.");
        return await this.findProjectFiles(parsedArguments, projectId, signal);
      }
      if (name === "write_file") {
        if (projectId === undefined) throw new Error("A workspace is required for file changes.");
        return await this.prepareWriteFile(parsedArguments, projectId, signal);
      }
      if (name === "delete_file") {
        if (projectId === undefined) throw new Error("A workspace is required for file changes.");
        return await this.prepareDeleteFile(parsedArguments, projectId, signal);
      }
      if (name === "replace_in_file") {
        if (projectId === undefined) throw new Error("A workspace is required for file changes.");
        return await this.prepareReplaceInFile(parsedArguments, projectId, signal);
      }
      if (name === "apply_patch") {
        if (projectId === undefined) throw new Error("A workspace is required for file changes.");
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
    const range = await readTextLines(filePath, input.startLine,
      input.endLine ?? input.startLine + (input.lineCount ?? MAX_READ_LINES) - 1, signal,
      input.endLine === undefined ? "lineCount" : "endLine");
    return this.success({
      ...range,
      path: input.path,
    });
  }

  private async prepareExternalFileRead(
    rawArguments: unknown,
    signal: AbortSignal,
  ): Promise<ToolExecution> {
    const input = externalReadFileArgumentsSchema.parse(rawArguments);
    const canonicalPath = await realpath(input.path);
    const fileInfo = await stat(canonicalPath);
    if (!fileInfo.isFile()) throw new Error("Requested external path is not a file.");
    if (fileInfo.size > MAX_READ_FILE_BYTES) {
      throw new Error("Requested external file exceeds the read size limit.");
    }
    throwIfAborted(signal);
    return {
      content: JSON.stringify({
        ok: true,
        value: {
          path: input.path,
          sizeBytes: fileInfo.size,
          status: "awaiting_approval",
        },
      }),
      externalRead: {
        canonicalPath,
        path: input.path,
        sizeBytes: fileInfo.size,
      },
      isError: false,
      kind: "external_read",
    };
  }

  public async executePreparedExternalFileRead(
    prepared: PreparedExternalFileRead,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const canonicalPath = await realpath(prepared.path);
    if (canonicalPath !== prepared.canonicalPath) {
      throw new Error("The external file path changed while approval was pending.");
    }
    const fileInfo = await stat(canonicalPath);
    if (!fileInfo.isFile() || fileInfo.size !== prepared.sizeBytes) {
      throw new Error("The external file changed while approval was pending.");
    }
    if (fileInfo.size > MAX_READ_FILE_BYTES) {
      throw new Error("Requested external file exceeds the read size limit.");
    }
    throwIfAborted(signal);
    const contents = await readFile(canonicalPath, "utf8");
    if (contents.includes("\u0000")) throw new Error("Requested external file is not UTF-8 text.");
    return this.success({
      content: contents,
      path: prepared.path,
      sizeBytes: fileInfo.size,
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
    if (!rootInfo.isDirectory() && !rootInfo.isFile()) {
      throw new ToolArgumentsError("Search path must be a regular file or directory.", [{
        code: "invalid_type", path: ["path"],
        message: "Provide a project-relative regular file or directory path; use an empty path for the project root.",
      }]);
    }
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
    if (!rootInfo.isDirectory()) throw new ToolArgumentsError("Search path is not a directory.", [
      { code: "invalid_type", path: ["path"], message: "find_files searches directories. To read a known file, use read_file; to search its contents, use search_text." },
    ]);

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
    try {
      return await this.runProjectMutation(
        projectId,
        { kind: "file", path: change.path },
        owner,
        signal,
        async () => {
          throwIfAborted(signal);
          const filePath = await this.projects.resolveWritableProjectPath(projectId, change.path);
          if (change.operation === "write_file" && change.expectedContent === null) {
            await mkdir(path.dirname(filePath), { recursive: true });
            await this.projects.resolveWritableProjectPath(projectId, change.path);
            throwIfAborted(signal);
          }
          const existing = await this.readEditableFile(filePath, true);
          if (existing !== change.expectedContent) {
            throw new PreparedFileChangeStaleError(
              change.path,
              change.expectedContent === null && existing !== null
                ? "The target file was created after the diff was generated."
                : "The file changed after the diff was generated. Read it again and prepare a new change.",
            );
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
        return this.operationConflict(error.conflict, "file");
      }
      if (error instanceof PreparedFileChangeStaleError) {
        return this.staleFileChange(error);
      }
      throw error;
    }
  }

  /**
   * Writes a project file from the desktop UI editor (not a model tool call).
   *
   * Participates in the same `runProjectMutation` lock as `applyPreparedChange`: a
   * command occupies the whole project (`scopesConflict` treats any command as
   * conflicting with any file), so a save issued while the Agent is mid-build must be
   * rejected, not silently interleaved. Errors propagate as the typed
   * `ProjectOperationConflictError`/`PreparedFileChangeStaleError` classes — already
   * recognized by `classifyError` as `CONFLICT`/`FILE_CHANGED` — instead of the
   * `ToolExecutionResult` JSON envelope `applyPreparedChange` uses for model consumption.
   *
   * The stale-check reads through `ProjectRegistry.readFile()` so user saves retain
   * the same text/binary preview semantics as the UI. Model tools accept bounded
   * localized edits to the same 2 MB source files while keeping input payloads small.
   */
  public async writeUserFile(
    input: WriteProjectFileInput,
    signal: AbortSignal,
  ): Promise<ProjectFile> {
    const filePath = await this.projects.resolveWritableProjectPath(input.projectId, input.path);
    return this.runProjectMutation(
      input.projectId,
      { kind: "file", path: input.path },
      USER_EDITOR_OPERATION_OWNER,
      signal,
      async () => {
        const current = await this.readCurrentFileForStaleCheck(input.projectId, input.path);
        if (current !== input.expectedContent) {
          throw new PreparedFileChangeStaleError(
            input.path,
            input.expectedContent === null && current !== null
              ? "The target file was created after it was opened for editing."
              : "The file changed after it was opened for editing. Reload it before saving again.",
          );
        }

        const temporaryPath = path.join(
          path.dirname(filePath),
          `.${path.basename(filePath)}.user-edit-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
        );
        try {
          await writeFile(temporaryPath, input.content, "utf8");
          throwIfAborted(signal);
          await rename(temporaryPath, filePath);
        } finally {
          await this.removeTemporaryFile(temporaryPath);
        }

        return projectFileSchema.parse({
          byteLength: Buffer.byteLength(input.content, "utf8"),
          content: input.content,
          isBinary: false,
          name: path.basename(filePath),
          path: input.path,
          projectId: input.projectId,
          truncated: false,
        });
      },
    );
  }

  /** `null` return means the file does not exist yet, matching `PreparedFileChange.expectedContent` semantics. */
  private async readCurrentFileForStaleCheck(
    projectId: string,
    relativePath: string,
  ): Promise<string | null> {
    let current: ProjectFile;
    try {
      current = await this.projects.readFile({ path: relativePath, projectId });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    if (current.isBinary || current.truncated) {
      throw new PreparedFileChangeStaleError(
        relativePath,
        "The file is binary or too large to safely overwrite from the editor. Reload it before saving again.",
      );
    }
    return current.content;
  }

  public async executePreparedCommand(
    command: PreparedCommand,
    projectId: string | undefined,
    signal: AbortSignal,
    owner: ProjectOperationOwner = unknownOperationOwner(),
    onOutput?: CommandOutputListener,
  ): Promise<ToolExecutionResult> {
    const launch = this.commands.prepareLaunch(command.command);
    try {
      let resolveStarted!: (commandId: string) => void;
      let rejectStarted!: (error: unknown) => void;
      const started = new Promise<string>((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      });
      const operation = this.runCommandMutation(
        projectId,
        owner.conversationId,
        { command: command.command, kind: "command", parallel: command.parallel },
        owner,
        signal,
        async (commandId) => {
          const workingDirectory = await this.resolveCommandWorkingDirectory(
            projectId,
            owner.conversationId,
          );
          throwIfAborted(signal);
          const completion = this.commands.start({
            commandId, command, projectId, conversationId: owner.conversationId,
            workingDirectory, signal, launch, onOutput,
          });
          resolveStarted(commandId);
          if (command.mode === "batch") await completion;
          return commandId;
        },
      );
      // Keep the batch operation/lock alive until process exit, even after
      // returning control to the model. Handle startup rejection separately.
      void operation.then(resolveStarted, rejectStarted);
      return await this.commands.observe(await started, command.yieldTimeMs, signal);
    } catch (error) {
      if (error instanceof ProjectOperationConflictError) {
        return this.operationConflict(error.conflict, "command");
      }
      throw error;
    }
  }

  public async executeApprovedCommandAction(
    command: string,
    projectId: string,
    signal: AbortSignal,
    owner: ProjectOperationOwner,
    action: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    try {
      return await this.runProjectMutation(
        projectId,
        { command, kind: "command", parallel: false },
        owner,
        signal,
        async () => action(),
      );
    } catch (error) {
      if (error instanceof ProjectOperationConflictError) {
        return this.operationConflict(error.conflict, "command");
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
    const update = parseCodexUpdatePatch(input.patch);
    if (update !== null) {
      const patchPath = this.toProjectRelativePatchPath(update.path);
      const filePath = await this.projects.resolveProjectPath(projectId, patchPath);
      const current = await this.readEditableFile(filePath, false);
      if (current === null) throw new Error("补丁目标文件不存在；新建文件请使用 write_file。");
      const next = update.apply(current);
      throwIfAborted(signal);
      return this.change({ content: next, expectedContent: current, operation: "apply_patch", path: patchPath });
    }
    const normalizedPatch = normalizeModelUnifiedDiff(input.patch);
    const patches = parsePatch(normalizedPatch);
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
    const next = applyPatch(current, normalizedPatch);
    if (next === false) {
      throw new Error(
        "补丁无法应用：@@ 块的行数声明或上下文与当前文件不匹配；请重新读取文件后生成新补丁，整段替换可改用 replace_in_file。",
      );
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
    const modeWasProvided = rawArguments !== null
      && typeof rawArguments === "object"
      && Object.hasOwn(rawArguments, "mode");
    const mode = !modeWasProvided && input.serviceName !== undefined
      ? "service"
      : input.mode;
    const command: PreparedCommand = {
      ...input,
      mode,
      timeoutMs: input.timeoutMs === undefined ? (mode === "batch" ? MAX_COMMAND_TIMEOUT_MS : null) : input.timeoutMs,
    };
    return {
      command,
      content: JSON.stringify({
        ok: true,
        value: {
          command: command.command,
          mode: command.mode,
          serviceName: command.serviceName ?? this.commands.defaultServiceName(command.command),
          status: "awaiting_approval",
          timeoutMs: command.timeoutMs,
        }
      }),
      isError: false,
      kind: "command"
    };
  }

  public listConversationCommands(conversationIds: readonly string[]): BackgroundCommand[] {
    return this.commands.listConversationCommands(conversationIds);
  }

  public async stopConversationCommand(commandId: string, conversationIds: readonly string[]): Promise<BackgroundCommand> {
    return this.commands.stopConversationCommand(commandId, conversationIds);
  }

  public readConversationCommand(commandId: string, conversationIds: readonly string[], maxChars = 24000): BackgroundCommandOutput {
    return this.commands.readConversationCommand(commandId, conversationIds, maxChars);
  }

  public async dispose(): Promise<void> {
    await this.commands.dispose();
  }

  private async readEditableFile(
    filePath: string,
    allowMissing: boolean
  ): Promise<string | null> {
    try {
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) throw new Error("Requested path is not a file.");
      if (fileInfo.size > MAX_EDITABLE_FILE_BYTES) {
        throw new ToolArgumentsError("文件超过可编辑大小上限。", [{
          code: "too_big",
          path: ["path"],
          message: `目标文件为 ${fileInfo.size} 字节，可编辑上限为 ${MAX_EDITABLE_FILE_BYTES} 字节。不能通过缩小补丁解决；请说明限制，不要重复提交相同请求。`,
        }]);
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
    if (input.content !== null && Buffer.byteLength(input.content, "utf8") > MAX_EDITABLE_FILE_BYTES) {
      throw new ToolArgumentsError("修改后的文件超过可编辑大小上限。", [{
        code: "too_big",
        path: ["path"],
        message: `修改后文件的 UTF-8 大小不能超过 ${MAX_EDITABLE_FILE_BYTES} 字节；请减少新增内容后重新生成变更。`,
      }]);
    }
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
    const workspaceKey = projectOperationWorkspaceKey(this.projects.getProject(projectId).rootPath);
    return this.runOperation(projectId, workspaceKey, scope, owner, signal, operation);
  }

  private async runCommandMutation<T>(
    projectId: string | undefined,
    conversationId: string,
    scope: ProjectOperationScope,
    owner: ProjectOperationOwner,
    signal: AbortSignal,
    operation: (operationId: string) => Promise<T>,
  ): Promise<T> {
    if (projectId !== undefined) {
      return this.runProjectMutation(projectId, scope, owner, signal, operation);
    }
    return this.runOperation(
      undefined,
      `temporary-command:${conversationId}`,
      scope,
      owner,
      signal,
      operation,
    );
  }

  private async runOperation<T>(
    projectId: string | undefined,
    workspaceKey: string,
    scope: ProjectOperationScope,
    owner: ProjectOperationOwner,
    signal: AbortSignal,
    operation: (operationId: string) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    const conflict = [...this.projectOperations.values()].find((candidate) =>
      candidate.workspaceKey === workspaceKey
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
      workspaceKey,
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

  private async resolveCommandWorkingDirectory(
    projectId: string | undefined,
    conversationId: string,
  ): Promise<string> {
    if (projectId !== undefined) {
      return (await this.projects.ensureWorkspaceRoot(projectId)).rootPath;
    }
    const key = conversationId.length > 0 ? conversationId : "unknown";
    let root = this.temporaryCommandRoots.get(key);
    if (root === undefined) {
      root = mkdtemp(path.join(os.tmpdir(), "agent-command-"));
      this.temporaryCommandRoots.set(key, root);
    }
    return root;
  }

  private listActiveProjectOperations(
    projectId: string,
    owner: ProjectOperationOwner,
  ): unknown[] {
    const workspaceKey = projectOperationWorkspaceKey(this.projects.getProject(projectId).rootPath);
    return [...this.projectOperations.values()]
      .filter((operation) =>
        operation.workspaceKey === workspaceKey
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
    const workspaceKey = projectOperationWorkspaceKey(this.projects.getProject(projectId).rootPath);
    if (operation === undefined || operation.workspaceKey !== workspaceKey) {
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

  private operationConflict(
    conflict: ProjectOperationRecord,
    requestKind: ProjectOperationScope["kind"],
  ): ToolExecutionResult {
    const recovery = requestKind === "file"
      ? {
          action: "reread_and_rebuild_change" as const,
          instruction: "本次文件变更请求已作废，不能排队或重试相同参数。必要时等待冲突操作结束，然后调用 read_file 读取最新内容，再重新生成变更。",
          retryable: true,
        }
      : undefined;
    return {
      content: toolErrorContent(
        new ProjectOperationConflictError(conflict),
        "tool:project_mutation",
        {
          code: "PROJECT_OPERATION_CONFLICT",
          ...(recovery === undefined ? {} : { recovery }),
          value: {
            conflict: publicProjectOperation(conflict),
            ...(requestKind === "command"
              ? {
                  nextActions: [
                    "调用 wait_for_project_operation 等待占用操作完成",
                    "重新评估最新工作区状态，仅在仍适用时生成新的命令",
                  ],
                }
              : {}),
            requestKind,
            status: "discarded",
          },
        },
      ),
      isError: true,
      kind: "completed",
    };
  }

  private staleFileChange(error: PreparedFileChangeStaleError): ToolExecutionResult {
    return {
      content: toolErrorContent(error, "tool:file_change", {
        value: {
          path: error.filePath,
          status: "discarded",
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
      this.commands.forgetCompleted(operation.operationId);
    }
  }

  private success(value: unknown): ToolExecutionResult {
    return { kind: "completed", content: JSON.stringify({ ok: true, value }), isError: false };
  }
}

function scopesConflict(left: ProjectOperationScope, right: ProjectOperationScope): boolean {
  return left.kind === "command"
    || right.kind === "command"
    || normalizeOperationPath(left.path) === normalizeOperationPath(right.path);
}

function normalizeOperationPath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function projectOperationWorkspaceKey(rootPath: string): string {
  const normalized = path.normalize(path.resolve(rootPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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

/**
 * Sentinel owner for saves issued directly from the desktop UI editor, outside any
 * Agent conversation. Distinct from `unknownOperationOwner()` so operation listings
 * can tell "a human is editing this file" apart from "an untracked caller".
 */
const USER_EDITOR_OPERATION_OWNER: ProjectOperationOwner = {
  conversationId: "user-editor",
  conversationTitle: "用户编辑器",
  runId: "user-editor",
};
