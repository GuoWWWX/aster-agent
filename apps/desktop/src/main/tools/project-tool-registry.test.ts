import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TERMINAL_CONFIGURATION } from "@agent/protocol";

import { ProjectRegistry } from "../projects/project-registry.js";
import { decodeTerminalOutput, ProjectToolRegistry } from "./project-tool-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 })
    )
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-tools-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.ts"), "alpha\nbeta alpha\n", "utf8");
  const projects = new ProjectRegistry();
  const project = await projects.registerDirectory(root);
  return { project, projects, tools: new ProjectToolRegistry(projects) };
}

async function createLargeFixture(fileCount = 400) {
  const { project, tools } = await createFixture();
  const generatedDirectory = path.join(project.rootPath, "generated");
  await mkdir(generatedDirectory);
  const contents = `export const marker = "large-workspace";\n${"x".repeat(8_000)}\n`;

  for (let offset = 0; offset < fileCount; offset += 40) {
    await Promise.all(
      Array.from(
        { length: Math.min(40, fileCount - offset) },
        (_, index) => {
          const fileIndex = String(offset + index).padStart(4, "0");
          return writeFile(path.join(generatedDirectory, `fixture-${fileIndex}.ts`), contents, "utf8");
        },
      ),
    );
  }

  return { project, tools };
}

describe("ProjectToolRegistry", () => {
  it("keeps the one-shot command shell independent from side-terminal preferences", () => {
    const projects = new ProjectRegistry();
    const tools = new ProjectToolRegistry(projects, {
      getConfiguration: () => ({
        ...DEFAULT_TERMINAL_CONFIGURATION,
        outputEncoding: "gbk",
        shell: process.platform === "win32" ? "pwsh" : "bash",
      }),
    });

    expect(tools.getCommandEnvironmentDescription()).toContain(
      process.platform === "win32" ? "Windows PowerShell" : "PWSH（PowerShell 7）",
    );
    expect(tools.getCommandEnvironmentDescription()).not.toContain("output decoding: auto");
    expect(tools.getCommandEnvironmentDescription()).toContain("output decoding: GBK");
  });

  it("writes an editor file atomically and rejects stale content", async () => {
    const { project, projects, tools } = await createFixture();
    const signal = new AbortController().signal;
    const opened = await projects.readFile({ projectId: project.id, path: "src/index.ts" });
    if (opened.content === null) throw new Error("Expected a text fixture.");

    await expect(tools.writeUserFile({
      content: "saved by editor\n",
      expectedContent: opened.content,
      path: "src/index.ts",
      projectId: project.id,
    }, signal)).resolves.toMatchObject({
      content: "saved by editor\n",
      path: "src/index.ts",
      truncated: false,
    });
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8"))
      .resolves.toBe("saved by editor\n");

    await writeFile(path.join(project.rootPath, "src", "index.ts"), "changed elsewhere\n", "utf8");
    await expect(tools.writeUserFile({
      content: "must not overwrite\n",
      expectedContent: "saved by editor\n",
      path: "src/index.ts",
      projectId: project.id,
    }, signal)).rejects.toMatchObject({ code: "FILE_CHANGED" });
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8"))
      .resolves.toBe("changed elsewhere\n");
  });

  it("rejects editor writes while a project command owns the workspace", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const command = await tools.execute(
      "run_command",
      JSON.stringify({ command: "Write-Output command-started; Start-Sleep -Milliseconds 250", timeoutMs: 10_000 }),
      project.id,
      signal,
    );
    if (command.kind !== "command") throw new Error("Expected a command proposal.");
    const commandPromise = tools.executePreparedCommand(command.command, project.id, signal, {
      conversationId: "conversation-command",
      conversationTitle: "终端 Agent",
      runId: "run-command",
    });

    await expect(tools.writeUserFile({
      content: "editor\n",
      expectedContent: null,
      path: "editor.txt",
      projectId: project.id,
    }, signal)).rejects.toMatchObject({ code: "PROJECT_OPERATION_CONFLICT" });
    await expect(commandPromise).resolves.toMatchObject({ isError: false });
  }, 20_000);

  it("rejects editor paths outside the project root", async () => {
    const { project, tools } = await createFixture();
    await expect(tools.writeUserFile({
      content: "blocked",
      expectedContent: null,
      path: "../outside.txt",
      projectId: project.id,
    }, new AbortController().signal)).rejects.toThrow();
  });

  it("automatically decodes UTF-8 and legacy Chinese terminal output", () => {
    const utf8Output = Buffer.from("UTF-8: 中文\n", "utf8");
    const gbkOutput = Buffer.concat([
      Buffer.from("GBK: ", "ascii"),
      Buffer.from("d6d0cec4", "hex"),
      Buffer.from("\r\n", "ascii"),
    ]);

    expect(decodeTerminalOutput(Buffer.concat([utf8Output, gbkOutput]), "auto")).toBe(
      "UTF-8: 中文\nGBK: 中文\r\n",
    );
  });

  it("declares safe read, file preparation, and command policies", async () => {
    const { tools } = await createFixture();

    const runCommand = tools.getDefinitions().find((tool) => tool.name === "run_command");
    expect(runCommand?.description).toContain("default choice for ordinary commands");
    expect(runCommand?.description).toContain("does not open a visible terminal tab");
    expect(runCommand?.description).toContain("terminal_control");
    expect(runCommand?.description).toContain("nonzero final exit code marks the command failed");
    expect(tools.getDefinitions().find((tool) => tool.name === "search_text")?.description)
      .toContain("successful empty result when nothing matches");
    expect(tools.getDefinitions().find((tool) => tool.name === "apply_patch")?.description)
      .toContain("not the marker-based patch protocol");
    expect(tools.getDefinitions().find((tool) => tool.name === "apply_patch")?.description)
      .toContain("--- a/src/x.ts\\n+++ b/src/x.ts");
    expect(tools.getDefinitions().find((tool) => tool.name === "replace_in_file")?.description)
      .toContain("Preferred editor for one exact change");

    expect(tools.getExecutionPolicy("read_file", JSON.stringify({ path: "src/index.ts" }), false))
      .toEqual({ group: "read", kind: "parallel" });
    expect(tools.getExecutionPolicy("replace_in_file", "{}", false))
      .toEqual({ kind: "serial", prepareBeforeBatch: true });
    expect(tools.getExecutionPolicy(
      "run_command",
      JSON.stringify({ command: "first", parallel: true }),
      true,
    )).toEqual({ group: "command", kind: "parallel" });
    expect(tools.getExecutionPolicy(
      "run_command",
      JSON.stringify({ command: "first" }),
      true,
    )).toEqual({ group: "command", kind: "parallel" });
    expect(tools.getExecutionPolicy(
      "run_command",
      JSON.stringify({ command: "first", parallel: false }),
      true,
    )).toEqual({ kind: "serial" });
    expect(tools.getExecutionPolicy(
      "run_command",
      JSON.stringify({ command: "first", parallel: true }),
      false,
    )).toEqual({ kind: "serial" });
  });

  it("runs temporary conversation commands without exposing project tools", async () => {
    const projects = new ProjectRegistry();
    const tools = new ProjectToolRegistry(projects);
    const signal = new AbortController().signal;
    const owner = {
      conversationId: "temporary-conversation",
      conversationTitle: "临时对话",
      runId: "temporary-run",
    };

    expect(tools.getCommandDefinitions().map((tool) => tool.name)).toEqual([
      "list_background_commands",
      "wait_for_commands",
      "stop_command",
      "run_command",
    ]);
    expect(tools.getProjectDefinitions().map((tool) => tool.name)).not.toContain("run_command");

    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({ command: "node -e \"console.log('temporary-command-ok')\"", yieldTimeMs: 10_000 }),
      undefined,
      signal,
      owner,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);
    const result = await tools.executePreparedCommand(proposal.command, undefined, signal, owner);

    expect(result.isError).toBe(false);
    expect(result.content).toContain("temporary-command-ok");
    expect(result.content).toContain("agent-command-");

    const commandValue = JSON.parse(result.content) as {
      value?: { commandId?: string };
    };
    const commandId = commandValue.value?.commandId;
    if (commandId === undefined) throw new Error("Expected a temporary command ID.");
    await expect(tools.execute(
      "wait_for_commands",
      JSON.stringify({ commandIds: [commandId] }),
      undefined,
      signal,
      { ...owner, conversationId: "other-conversation" },
    )).resolves.toMatchObject({ isError: true });
  }, 20_000);

  it("executes every advertised project tool inside an isolated project", async () => {
    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;

    const listing = await tools.execute("list_directory", JSON.stringify({ path: "src" }), project.id, signal);
    expect(listing.isError).toBe(false);
    expect(listing.content).toContain("index.ts");

    const read = await tools.execute(
      "read_file",
      JSON.stringify({ path: "src/index.ts" }),
      project.id,
      signal
    );
    expect(read.isError).toBe(false);
    expect(read.content).toContain("beta alpha");

    const search = await tools.execute(
      "search_text",
      JSON.stringify({ query: "alpha" }),
      project.id,
      signal
    );
    expect(search.isError).toBe(false);
    expect(search.content).toContain("src/index.ts");

    const find = await tools.execute(
      "find_files",
      JSON.stringify({ pattern: "**/*.ts" }),
      project.id,
      signal
    );
    expect(find.isError).toBe(false);
    expect(find.content).toContain("src/index.ts");

    const write = await tools.execute(
      "write_file",
      JSON.stringify({ content: "draft\n", path: "notes.txt" }),
      project.id,
      signal
    );
    if (write.kind !== "change") throw new Error(write.content);
    await tools.applyPreparedChange(write.change, project.id, signal);
    await expect(readFile(path.join(project.rootPath, "notes.txt"), "utf8")).resolves.toBe("draft\n");

    const replace = await tools.execute(
      "replace_in_file",
      JSON.stringify({ newText: "omega\nbeta", oldText: "alpha\nbeta", path: "src/index.ts" }),
      project.id,
      signal
    );
    if (replace.kind !== "change") throw new Error(replace.content);
    await tools.applyPreparedChange(replace.change, project.id, signal);
    await expect(readFile(path.join(project.rootPath, "src/index.ts"), "utf8")).resolves.toBe(
      "omega\nbeta alpha\n"
    );

    const patch = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "--- a/notes.txt",
          "+++ b/notes.txt",
          "@@ -1,1 +1,1 @@",
          "-draft",
          "+final",
          ""
        ].join("\n")
      }),
      project.id,
      signal
    );
    if (patch.kind !== "change") throw new Error(patch.content);
    await tools.applyPreparedChange(patch.change, project.id, signal);
    await expect(readFile(path.join(project.rootPath, "notes.txt"), "utf8")).resolves.toBe("final\n");

    const command = await tools.execute(
      "run_command",
      JSON.stringify({ command: "Test-Path notes.txt" }),
      project.id,
      signal
    );
    if (command.kind !== "command") throw new Error(command.content);
    const commandResult = await tools.executePreparedCommand(command.command, project.id, signal);
    expect(commandResult.isError).toBe(false);
    expect(commandResult.content).toContain("True");

    const deletion = await tools.execute(
      "delete_file",
      JSON.stringify({ path: "notes.txt" }),
      project.id,
      signal
    );
    if (deletion.kind !== "change") throw new Error(deletion.content);
    await tools.applyPreparedChange(deletion.change, project.id, signal);
    await expect(readFile(path.join(project.rootPath, "notes.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    expect(tools.getDefinitions().map((tool) => tool.name)).toEqual([
      "list_project_operations",
      "wait_for_project_operation",
      "list_background_commands",
      "wait_for_commands",
      "stop_command",
      "list_directory",
      "read_file",
      "read_external_file",
      "search_text",
      "find_files",
      "write_file",
      "delete_file",
      "replace_in_file",
      "apply_patch",
      "run_command"
    ]);
  }, 20_000);

  it("reads a bounded line range", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "read_file",
      JSON.stringify({ endLine: 2, path: "src/index.ts", startLine: 2 }),
      project.id,
      new AbortController().signal
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("beta alpha");
  });

  it("prepares an external read without exposing content before approval", async () => {
    const { project, tools } = await createFixture();
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "agent-tools-external-"));
    temporaryDirectories.push(externalRoot);
    const externalPath = path.join(externalRoot, "agent-external-read.txt");
    await writeFile(externalPath, "outside content\n", "utf8");

    const prepared = await tools.execute(
      "read_external_file",
      JSON.stringify({ path: externalPath }),
      project.id,
      new AbortController().signal,
    );
    expect(prepared.kind).toBe("external_read");
    expect(prepared.content).not.toContain("outside content");
    if (prepared.kind !== "external_read") throw new Error("Expected an external read proposal.");

    const completed = await tools.executePreparedExternalFileRead(
      prepared.externalRead,
      new AbortController().signal,
    );
    expect(completed.isError).toBe(false);
    expect(completed.content).toContain("outside content");
  });

  const invalidReadRanges: Array<{
    input: { endLine: number; path: string; startLine: number };
    message: string;
  }> = [
    {
      input: { endLine: 1, path: "src/index.ts", startLine: 2 },
      message: "endLine must be greater than or equal to startLine.",
    },
    {
      input: { endLine: 402, path: "src/index.ts", startLine: 1 },
      message: "The selected line range cannot exceed 400 lines.",
    },
  ];

  it.each(invalidReadRanges)("returns a field-level recovery issue for an invalid read range", async ({ input, message }) => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "read_file",
      JSON.stringify(input),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      recovery?: { issues?: Array<{ message: string; path: Array<string | number> }> };
    };

    expect(result.isError).toBe(true);
    const issue = payload.recovery?.issues?.find((candidate) => candidate.path.join(".") === "endLine");
    expect(issue?.path).toEqual(["endLine"]);
    expect(issue?.message).toContain(message);
  });

  it("searches text without leaving the project", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "search_text",
      JSON.stringify({ path: "src", query: "alpha" }),
      project.id,
      new AbortController().signal
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain('"line":1');
    expect(result.content).toContain('"line":2');
  });

  it("uses literal ripgrep search and respects project ignore files", async () => {
    const { project, tools } = await createFixture();
    await mkdir(path.join(project.rootPath, "ignored"));
    await writeFile(path.join(project.rootPath, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(path.join(project.rootPath, "src", "literal.ts"), "const marker = 'a+b[1]';\n", "utf8");
    await writeFile(path.join(project.rootPath, "ignored", "secret.ts"), "a+b[1]\n", "utf8");

    const result = await tools.execute(
      "search_text",
      JSON.stringify({ query: "a+b[1]" }),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      value: { matches: Array<{ path: string; text: string }> };
    };

    expect(result.isError).toBe(false);
    expect(payload.value.matches).toEqual([
      expect.objectContaining({ path: "src/literal.ts", text: "const marker = 'a+b[1]';" }),
    ]);
  });

  it("supports regex, case handling, and include/exclude globs in structured search", async () => {
    const { project, tools } = await createFixture();
    await writeFile(path.join(project.rootPath, "src", "regex.ts"), "AlphaOne\n", "utf8");
    await writeFile(path.join(project.rootPath, "src", "regex.test.ts"), "AlphaTwo\n", "utf8");
    await writeFile(path.join(project.rootPath, "regex.md"), "AlphaOne\n", "utf8");
    await mkdir(path.join(project.rootPath, "node_modules", "fixture"), { recursive: true });
    await writeFile(
      path.join(project.rootPath, "node_modules", "fixture", "secret.ts"),
      "AlphaOne\n",
      "utf8",
    );

    const result = await tools.execute(
      "search_text",
      JSON.stringify({
        caseMode: "insensitive",
        excludeGlobs: ["**/*.test.ts"],
        includeGlobs: ["**/*.ts"],
        mode: "regex",
        query: "^alpha(one|two)$",
      }),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      value: {
        caseMode: string;
        matches: Array<{ path: string }>;
        mode: string;
      };
    };

    expect(result.isError).toBe(false);
    expect(payload.value).toMatchObject({ caseMode: "insensitive", mode: "regex" });
    expect(payload.value.matches).toEqual([expect.objectContaining({ path: "src/regex.ts" })]);
  });

  it("finds files through ripgrep with POSIX paths and ignore rules", async () => {
    const { project, tools } = await createFixture();
    await mkdir(path.join(project.rootPath, "ignored"));
    await writeFile(path.join(project.rootPath, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(path.join(project.rootPath, "src", "second.ts"), "export {};\n", "utf8");
    await writeFile(path.join(project.rootPath, "src", "中文文件.ts"), "export {};\n", "utf8");
    await writeFile(path.join(project.rootPath, "ignored", "secret.ts"), "export {};\n", "utf8");

    const result = await tools.execute(
      "find_files",
      JSON.stringify({ pattern: "**/*.ts" }),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as { value: { matches: string[] } };

    expect(result.isError).toBe(false);
    expect(payload.value.matches).toEqual(expect.arrayContaining([
      "src/index.ts",
      "src/second.ts",
      "src/中文文件.ts",
    ]));
    expect(payload.value.matches).not.toContain("ignored/secret.ts");
    expect(payload.value.matches.every((filePath) => !filePath.includes("\\"))).toBe(true);
  });

  it("returns a successful empty ripgrep result with scan statistics", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "search_text",
      JSON.stringify({ query: "not-present" }),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      value: { matches: unknown[]; scannedFiles: number; truncated: boolean };
    };

    expect(result.isError).toBe(false);
    expect(payload.value).toMatchObject({ matches: [], truncated: false });
    expect(payload.value.scannedFiles).toBeGreaterThan(0);
  });

  it("stops ripgrep after the requested global result limit", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "search_text",
      JSON.stringify({ maxResults: 1, query: "alpha" }),
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      value: { matches: unknown[]; truncated: boolean };
    };

    expect(result.isError).toBe(false);
    expect(payload.value.matches).toHaveLength(1);
    expect(payload.value.truncated).toBe(true);
  });

  it("does not start ripgrep after search cancellation", async () => {
    const { project, tools } = await createFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(tools.execute(
      "find_files",
      JSON.stringify({ pattern: "**/*.ts" }),
      project.id,
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds long search excerpts before returning them to the model", async () => {
    const { project, tools } = await createFixture();
    const longLine = `${"x".repeat(2_000)} alpha`;
    await writeFile(path.join(project.rootPath, "src", "long.ts"), longLine, "utf8");

    const result = await tools.execute(
      "search_text",
      JSON.stringify({ path: "src", query: "alpha" }),
      project.id,
      new AbortController().signal
    );
    const payload = JSON.parse(result.content) as {
      value: { matches: Array<{ path: string; text: string }> };
    };
    const match = payload.value.matches.find((item) => item.path === "src/long.ts");

    expect(result.isError).toBe(false);
    expect(match?.text).toHaveLength(803);
    expect(match?.text.endsWith("...")).toBe(true);
  });

  it("previews and applies an exact replacement without changing another match", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "replace_in_file",
      JSON.stringify({
        expectedReplacements: 1,
        newText: "gamma",
        oldText: "beta alpha",
        path: "src/index.ts"
      }),
      project.id,
      new AbortController().signal
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    expect(proposal.change.diff).toContain("-beta alpha");
    await tools.applyPreparedChange(
      proposal.change,
      project.id,
      new AbortController().signal
    );

    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toBe(
      "alpha\ngamma\n"
    );
  });

  it("rejects an edit when the file changes after its diff was prepared", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "write_file",
      JSON.stringify({ content: "created\n", path: "new.txt" }),
      project.id,
      new AbortController().signal
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    await writeFile(path.join(project.rootPath, "new.txt"), "external\n", "utf8");
    const result = await tools.applyPreparedChange(
      proposal.change,
      project.id,
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      agentError?: { code?: string; retryable?: boolean };
      recovery?: { action?: string; instruction?: string; retryable?: boolean };
      value?: { path?: string; status?: string };
    };

    expect(result.isError).toBe(true);
    expect(payload.agentError).toMatchObject({ code: "FILE_CHANGED", retryable: true });
    expect(payload.recovery).toMatchObject({
      action: "reread_and_rebuild_change",
      retryable: true,
    });
    expect(payload.recovery?.instruction).toContain("不能排队或重试相同参数");
    expect(payload.value).toEqual({ path: "new.txt", status: "discarded" });
    await expect(readFile(path.join(project.rootPath, "new.txt"), "utf8")).resolves.toBe("external\n");
  });

  it("previews and applies a file deletion after approval", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "delete_file",
      JSON.stringify({ path: "src/index.ts" }),
      project.id,
      new AbortController().signal
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    expect(proposal.change.diff).toContain("-alpha");
    await tools.applyPreparedChange(proposal.change, project.id, new AbortController().signal);

    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("uses a unified patch to propose several localized edits in one file", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "--- a/src/index.ts",
          "+++ b/src/index.ts",
          "@@ -1,2 +1,2 @@",
          "-alpha",
          "-beta alpha",
          "+first",
          "+second",
          ""
        ].join("\n")
      }),
      project.id,
      new AbortController().signal
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    await tools.applyPreparedChange(proposal.change, project.id, new AbortController().signal);
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toBe(
      "first\nsecond\n"
    );
  });

  it("accepts a standard unified diff with GPT/Codex wrapper markers", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "*** Begin Patch",
          "--- a/src/index.ts",
          "+++ b/src/index.ts",
          "@@ -1,2 +1,2 @@",
          "-alpha",
          "+first",
          " beta alpha",
          "*** End Patch",
        ].join("\n"),
      }),
      project.id,
      new AbortController().signal,
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    await tools.applyPreparedChange(proposal.change, project.id, new AbortController().signal);
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toBe(
      "first\nbeta alpha\n",
    );
  });

  it("repairs GPT-generated hunk counts when the patch body and file context are valid", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "*** Begin Patch",
          "--- a/src/index.ts",
          "+++ b/src/index.ts",
          "@@ -1,20 +1,40 @@",
          "-alpha",
          "+first",
          " beta alpha",
          "*** End Patch",
        ].join("\n"),
      }),
      project.id,
      new AbortController().signal,
    );

    if (proposal.kind !== "change") throw new Error(proposal.content);
    await tools.applyPreparedChange(proposal.change, project.id, new AbortController().signal);
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toBe(
      "first\nbeta alpha\n",
    );
  });

  it("reports the unsupported GPT/Codex patch directive precisely", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "*** Begin Patch",
          "*** Update File: src/index.ts",
          "@@",
          "-alpha",
          "+first",
          "*** End Patch",
        ].join("\n"),
      }),
      project.id,
      new AbortController().signal,
    );

    expect(result.kind).toBe("completed");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("*** Update File:");
    expect(result.content).toContain("标准 ---/+++ diff");
  });

  it("reports a mismatched GPT-generated hunk instead of blaming file headers", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "--- a/src/index.ts",
          "+++ b/src/index.ts",
          "@@ -1,2 +1,2 @@",
          "-alpha",
          "+first",
          " missing context",
          "*** End Patch",
        ].join("\n"),
      }),
      project.id,
      new AbortController().signal,
    );

    expect(result.kind).toBe("completed");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("@@ 块的行数声明或上下文");
    expect(result.content).not.toContain("文件头开头");
  });

  it("directs Codex-style new-file patches to write_file", async () => {
    const { project, tools } = await createFixture();
    const result = await tools.execute(
      "apply_patch",
      JSON.stringify({
        patch: [
          "*** Begin Patch",
          "*** Add File: BubbleSort.java",
          "+public class BubbleSort {}",
          "*** End Patch"
        ].join("\n")
      }),
      project.id,
      new AbortController().signal
    );

    expect(result.kind).toBe("completed");
    expect(result.isError).toBe(true);
    const payload: unknown = JSON.parse(result.content);
    expect(payload).toMatchObject({
      agentError: {
        code: "VALIDATION_FAILED"
      },
      ok: false
    });
    if (payload === null || typeof payload !== "object") throw new Error("Expected an error payload.");
    const agentError: unknown = Reflect.get(payload, "agentError");
    if (agentError === null || typeof agentError !== "object") throw new Error("Expected an Agent error.");
    const message: unknown = Reflect.get(agentError, "message");
    expect(message).toContain("write_file");
    await expect(readFile(path.join(project.rootPath, "BubbleSort.java"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("prepares and executes a PowerShell command inside the project root", async () => {
    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({ command: "Write-Output agent-command-ok", timeoutMs: 10_000 }),
      project.id,
      new AbortController().signal
    );

    if (proposal.kind !== "command") throw new Error(proposal.content);
    expect(proposal.content).toContain("awaiting_approval");
    const result = await tools.executePreparedCommand(
      proposal.command,
      project.id,
      new AbortController().signal
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("agent-command-ok");
    const payload = JSON.parse(result.content) as {
      value: { workingDirectory: string };
    };
    expect(payload.value.workingDirectory).toBe(project.rootPath);
  });

  it("waits for a batch command to finish even when yieldTimeMs is zero", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'Write-Output "batch-start"; Start-Sleep -Milliseconds 250; Write-Output "batch-finished"',
        yieldTimeMs: 0,
      }),
      project.id,
      signal,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);

    const result = await tools.executePreparedCommand(proposal.command, project.id, signal);
    const payload = JSON.parse(result.content) as {
      value?: { mode?: unknown; status?: unknown; stdout?: unknown; timeoutMs?: unknown };
    };

    expect(result.isError).toBe(false);
    expect(payload.value).toMatchObject({
      mode: "batch",
      status: "completed",
      timeoutMs: 30 * 60_000,
    });
    expect(payload.value?.stdout).toContain("batch-start");
    expect(payload.value?.stdout).toContain("batch-finished");
  });

  it("streams command output before the command completes", async () => {
    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const owner = {
      conversationId: "conversation-streaming-command",
      conversationTitle: "流式命令",
      runId: "run-streaming-command",
    };
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'Write-Output "stream-first"; Start-Sleep -Milliseconds 1000; [Console]::Error.WriteLine("stream-error")',
        mode: "service",
        timeoutMs: 10_000,
        yieldTimeMs: 0,
      }),
      project.id,
      signal,
      owner,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);

    const outputEvents: Array<{ delta: string; done: boolean; stream: string }> = [];
    let resolveFirstOutput: (() => void) | undefined;
    const firstOutput = new Promise<void>((resolve) => {
      resolveFirstOutput = resolve;
    });
    const started = await tools.executePreparedCommand(
      proposal.command,
      project.id,
      signal,
      owner,
      ({ delta, done, stream }) => {
        outputEvents.push({ delta, done, stream });
        if (stream === "stdout" && delta.includes("stream-first")) resolveFirstOutput?.();
      },
    );
    const startedPayload = JSON.parse(started.content) as {
      value?: { commandId?: unknown; status?: unknown };
    };
    expect(startedPayload.value?.status).toBe("running");
    if (typeof startedPayload.value?.commandId !== "string") {
      throw new Error("Expected a background command id.");
    }
    await Promise.race([
      firstOutput,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for output.")), 3_000)),
    ]);
    expect(outputEvents.some((event) => event.stream === "stdout" && event.delta.includes("stream-first")))
      .toBe(true);
    expect(outputEvents.some((event) => event.done)).toBe(false);

    const waited = await tools.execute(
      "wait_for_commands",
      JSON.stringify({ commandIds: [startedPayload.value.commandId], timeoutMs: 10_000 }),
      project.id,
      signal,
      owner,
    );
    expect(waited.content).toContain("stream-error");
    expect(outputEvents.some((event) => event.stream === "stderr" && event.delta.includes("stream-error")))
      .toBe(true);
    expect(outputEvents.some((event) => event.done)).toBe(true);
  });

  it("makes the bundled ripgrep executable available to shell commands", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: "rg --version; rg -n --with-filename --fixed-strings alpha src/index.ts",
      }),
      project.id,
      new AbortController().signal,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);

    const result = await tools.executePreparedCommand(
      proposal.command,
      project.id,
      new AbortController().signal,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("ripgrep");
    expect(result.content).toContain("src/index.ts:1:alpha");
  });

  it("keeps UTF-8 ripgrep output intact through a PowerShell pipeline", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    await writeFile(path.join(project.rootPath, "中文文件.txt"), "命中内容\n", "utf8");
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'rg -n "命中内容" . | Select-Object -First 1',
      }),
      project.id,
      new AbortController().signal,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);

    const result = await tools.executePreparedCommand(
      proposal.command,
      project.id,
      new AbortController().signal,
    );

    // Depending on PowerShell and rg versions, Select-Object may either let rg
    // exit cleanly or close the pipe early. In both cases, retained UTF-8 output
    // must not be mojibake.
    expect(result.content).toContain("中文文件.txt:1:命中内容");
    expect(result.content).not.toContain("涓");
  });

  it("decodes native Windows terminal output with the default terminal", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'Write-Output "中文终端"; ping -?',
        timeoutMs: 10_000,
      }),
      project.id,
      new AbortController().signal,
    );

    if (proposal.kind !== "command") throw new Error(proposal.content);
    const result = await tools.executePreparedCommand(
      proposal.command,
      project.id,
      new AbortController().signal,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("中文终端");
    expect(result.content).toContain("Ping");
    expect(result.content).not.toContain("\uFFFD");
  });

  it("starts independent commands, waits for all of them, and returns their output", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const owner = {
      conversationId: "conversation-command-batch",
      conversationTitle: "命令批次",
      runId: "run-command-batch",
    };
    const proposals = await Promise.all([
      tools.execute(
        "run_command",
        JSON.stringify({
          command: "Start-Sleep -Milliseconds 150; Write-Output command-one",
          mode: "service",
          parallel: true,
          timeoutMs: 10_000,
          yieldTimeMs: 0,
        }),
        project.id,
        signal,
        owner,
      ),
      tools.execute(
        "run_command",
        JSON.stringify({
          command: "Start-Sleep -Milliseconds 100; Write-Output command-two",
          mode: "service",
          parallel: true,
          timeoutMs: 10_000,
          yieldTimeMs: 0,
        }),
        project.id,
        signal,
        owner,
      ),
    ]);
    const commands = proposals.map((proposal) => {
      if (proposal.kind !== "command") throw new Error("Expected a prepared command.");
      return proposal.command;
    });
    const started = await Promise.all(
      commands.map((command) => tools.executePreparedCommand(command, project.id, signal, owner)),
    );
    const commandIds = started.map((result) => {
      const payload = JSON.parse(result.content) as {
        value?: { commandId?: unknown; status?: unknown };
      };
      expect(payload.value?.status).toBe("running");
      if (typeof payload.value?.commandId !== "string") {
        throw new Error("Background command id was not returned.");
      }
      return payload.value.commandId;
    });

    const waited = await tools.execute(
      "wait_for_commands",
      JSON.stringify({ commandIds, timeoutMs: 10_000, waitFor: "all" }),
      project.id,
      signal,
      owner,
    );

    expect(waited.isError).toBe(false);
    expect(waited.content).toContain('"waitStatus":"finished"');
    expect(waited.content).toContain("command-one");
    expect(waited.content).toContain("command-two");
    expect(waited.content.match(/"status":"completed"/g)).toHaveLength(2);
  });

  it("stops a running background command by command id", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: "Start-Sleep -Seconds 5; Write-Output should-not-complete",
        mode: "service",
        timeoutMs: 10_000,
        yieldTimeMs: 0,
      }),
      project.id,
      signal,
    );
    if (proposal.kind !== "command") throw new Error("Expected a prepared command.");
    const started = await tools.executePreparedCommand(proposal.command, project.id, signal);
    const startedPayload = JSON.parse(started.content) as { value?: { commandId?: unknown } };
    const commandId = startedPayload.value?.commandId;
    if (typeof commandId !== "string") throw new Error("Background command id was not returned.");

    const stopped = await tools.execute(
      "stop_command",
      JSON.stringify({ commandId }),
      project.id,
      signal,
    );
    const waited = await tools.execute(
      "wait_for_commands",
      JSON.stringify({ commandIds: [commandId], timeoutMs: 10_000 }),
      project.id,
      signal,
    );

    expect(stopped.content).toContain('"status":"cancelled"');
    expect(waited.content).toContain('"waitStatus":"finished"');
    expect(waited.content).toContain('"status":"cancelled"');
  });

  it("lists active background services with names and command ids for their owning conversation", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const owner = {
      conversationId: "conversation-background-services",
      conversationTitle: "后台服务",
      runId: "run-background-services",
    };
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: "Start-Sleep -Seconds 30",
        serviceName: "Vite development server",
        timeoutMs: 60_000,
        yieldTimeMs: 0,
      }),
      project.id,
      signal,
      owner,
    );
    if (proposal.kind !== "command") throw new Error("Expected a prepared command.");
    const started = await tools.executePreparedCommand(proposal.command, project.id, signal, owner);
    const startedPayload = JSON.parse(started.content) as {
      value?: { commandId?: unknown };
    };
    const commandId = startedPayload.value?.commandId;
    if (typeof commandId !== "string") throw new Error("Background command id was not returned.");

    const active = await tools.execute(
      "list_background_commands",
      JSON.stringify({}),
      project.id,
      signal,
      owner,
    );
    const otherConversation = await tools.execute(
      "list_background_commands",
      JSON.stringify({}),
      project.id,
      signal,
      { ...owner, conversationId: "other-conversation" },
    );
    await tools.execute(
      "stop_command",
      JSON.stringify({ commandId }),
      project.id,
      signal,
      owner,
    );
    const afterStop = await tools.execute(
      "list_background_commands",
      JSON.stringify({}),
      project.id,
      signal,
      owner,
    );

    expect(JSON.parse(active.content)).toMatchObject({
      ok: true,
      value: {
        commands: [{
          command: "Start-Sleep -Seconds 30",
          commandId,
          mode: "service",
          serviceName: "Vite development server",
          status: "running",
          timeoutMs: 60_000,
          workingDirectory: project.rootPath,
        }],
      },
    });
    expect(JSON.parse(otherConversation.content)).toMatchObject({
      ok: true,
      value: { commands: [] },
    });
    expect(JSON.parse(afterStop.content)).toMatchObject({
      ok: true,
      value: { commands: [] },
    });
  });

  it("releases the project operation lock after a service starts", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const owner = {
      conversationId: "conversation-service-lock",
      conversationTitle: "后台服务不占锁",
      runId: "run-service-lock",
    };
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: "Start-Sleep -Seconds 30",
        mode: "service",
        serviceName: "test service",
        yieldTimeMs: 0,
      }),
      project.id,
      signal,
      owner,
    );
    if (proposal.kind !== "command") throw new Error(proposal.content);
    const started = await tools.executePreparedCommand(proposal.command, project.id, signal, owner);
    const payload = JSON.parse(started.content) as {
      value?: { commandId?: unknown; status?: unknown; timeoutMs?: unknown };
    };
    if (typeof payload.value?.commandId !== "string") throw new Error("Expected a service ID.");

    expect(payload.value).toMatchObject({ status: "running", timeoutMs: null });
    await expect(tools.writeUserFile({
      content: "written while service is active\n",
      expectedContent: null,
      path: "service-write.txt",
      projectId: project.id,
    }, signal)).resolves.toMatchObject({ path: "service-write.txt" });
    await tools.execute(
      "stop_command",
      JSON.stringify({ commandId: payload.value.commandId }),
      project.id,
      signal,
      owner,
    );
  });

  it("keeps independent read tools responsive on a large workspace", async () => {
    const { project, tools } = await createLargeFixture();
    const signal = new AbortController().signal;
    const startedAt = performance.now();
    const results = await Promise.all([
      ...Array.from({ length: 16 }, (_, index) =>
        tools.execute(
          "read_file",
          JSON.stringify({ path: `generated/fixture-${String(index).padStart(4, "0")}.ts` }),
          project.id,
          signal,
        ),
      ),
      ...Array.from({ length: 4 }, () =>
        tools.execute(
          "search_text",
          JSON.stringify({ maxResults: 100, query: "not-present-in-fixture" }),
          project.id,
          signal,
        ),
      ),
      ...Array.from({ length: 4 }, () =>
        tools.execute(
          "find_files",
          JSON.stringify({ maxResults: 500, pattern: "generated/**/*.ts" }),
          project.id,
          signal,
        ),
      ),
    ]);
    const elapsedMs = performance.now() - startedAt;

    expect(results.every((result) => !result.isError)).toBe(true);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it("reports the owning conversation when concurrent changes target the same file", async () => {
    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const [firstProposal, secondProposal] = await Promise.all([
      tools.execute(
        "replace_in_file",
        JSON.stringify({
          newText: "first\nbeta alpha",
          oldText: "alpha\nbeta alpha",
          path: "src/index.ts",
        }),
        project.id,
        signal,
      ),
      tools.execute(
        "replace_in_file",
        JSON.stringify({
          newText: "second\nbeta alpha",
          oldText: "alpha\nbeta alpha",
          path: "src/index.ts",
        }),
        project.id,
        signal,
      ),
    ]);
    if (firstProposal.kind !== "change" || secondProposal.kind !== "change") {
      throw new Error("Expected two file change proposals.");
    }

    const results = await Promise.allSettled([
      tools.applyPreparedChange(firstProposal.change, project.id, signal),
      tools.applyPreparedChange(secondProposal.change, project.id, signal),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const values = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    expect(values.filter((result) => !result.isError)).toHaveLength(1);
    expect(values.filter((result) => result.isError)).toHaveLength(1);
    expect(values.find((result) => result.isError)?.content).toContain(
      "PROJECT_OPERATION_CONFLICT",
    );
    const conflictResult = values.find((result) => result.isError);
    if (conflictResult === undefined) throw new Error("Expected a conflict result.");
    const conflictPayload = JSON.parse(conflictResult.content) as {
      agentError?: { code?: string; retryable?: boolean };
      recovery?: { action?: string; instruction?: string; retryable?: boolean };
      value?: { requestKind?: string; status?: string };
    };
    expect(conflictPayload.agentError).toMatchObject({ code: "CONFLICT", retryable: false });
    expect(conflictPayload.recovery).toMatchObject({
      action: "reread_and_rebuild_change",
      retryable: true,
    });
    expect(conflictPayload.value).toMatchObject({ requestKind: "file", status: "discarded" });
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toMatch(
      /^(?:first|second)\nbeta alpha\n$/,
    );
  });

  it("treats Windows path casing as the same file operation", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const proposal = await tools.execute(
      "replace_in_file",
      JSON.stringify({
        expectedReplacements: 1,
        newText: "first",
        oldText: "beta alpha",
        path: "src/index.ts",
      }),
      project.id,
      signal,
    );
    if (proposal.kind !== "change") throw new Error(proposal.content);
    const firstChange = proposal.change;
    const secondChange = {
      ...proposal.change,
      content: proposal.change.content?.replace("first", "second") ?? null,
      path: "src/INDEX.ts",
    };

    const results = await Promise.all([
      tools.applyPreparedChange(firstChange, project.id, signal),
      tools.applyPreparedChange(secondChange, project.id, signal),
    ]);
    expect(results.filter((result) => !result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    const failed = results.find((result) => result.isError);
    if (failed === undefined) throw new Error("Expected a conflicting result.");
    expect(failed.content).toContain("reread_and_rebuild_change");
  });

  it("coordinates writes across conversations mounted to the same physical workspace", async () => {
    const { project, projects, tools } = await createFixture();
    const firstWorkspace = await projects.mountConversationWorkspace(
      "00000000-0000-4000-8000-000000000001",
      project.rootPath,
    );
    const secondWorkspace = await projects.mountConversationWorkspace(
      "00000000-0000-4000-8000-000000000002",
      project.rootPath,
    );
    const signal = new AbortController().signal;
    const [firstProposal, secondProposal] = await Promise.all([
      tools.execute(
        "replace_in_file",
        JSON.stringify({ newText: "first", oldText: "beta alpha", path: "src/index.ts" }),
        firstWorkspace.id,
        signal,
      ),
      tools.execute(
        "replace_in_file",
        JSON.stringify({ newText: "second", oldText: "beta alpha", path: "src/index.ts" }),
        secondWorkspace.id,
        signal,
      ),
    ]);
    if (firstProposal.kind !== "change" || secondProposal.kind !== "change") {
      throw new Error("Expected two file change proposals.");
    }

    const results = await Promise.all([
      tools.applyPreparedChange(firstProposal.change, firstWorkspace.id, signal),
      tools.applyPreparedChange(secondProposal.change, secondWorkspace.id, signal),
    ]);

    expect(results.filter((result) => !result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(results.find((result) => result.isError)?.content).toContain(
      "PROJECT_OPERATION_CONFLICT",
    );
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toMatch(
      /^alpha\n(?:first|second)\n$/,
    );
  });

  it("applies concurrent changes to different files without cross-file interference", async () => {
    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const proposals = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        tools.execute(
          "write_file",
          JSON.stringify({ content: `value-${index}\n`, path: `file-${index}.txt` }),
          project.id,
          signal,
        ),
      ),
    );
    const changes = proposals.map((proposal) => {
      if (proposal.kind !== "change") {
        throw new Error("Expected concurrent file change proposals.");
      }
      return proposal.change;
    });

    await expect(
      Promise.all(
        changes.map((change) => tools.applyPreparedChange(change, project.id, signal)),
      ),
    ).resolves.toHaveLength(20);
    await expect(readFile(path.join(project.rootPath, "file-19.txt"), "utf8")).resolves.toBe(
      "value-19\n",
    );
  });

  it("reports a command owner instead of racing a conflicting file change", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const signal = new AbortController().signal;
    const command = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'Start-Sleep -Milliseconds 250; Set-Content -NoNewline -LiteralPath command-target.txt -Value "command"',
        timeoutMs: 10_000,
      }),
      project.id,
      signal,
    );
    const change = await tools.execute(
      "write_file",
      JSON.stringify({ content: "agent\n", path: "command-target.txt" }),
      project.id,
      signal,
    );
    if (command.kind !== "command" || change.kind !== "change") {
      throw new Error("Expected a command and a file change proposal.");
    }

    const commandPromise = tools.executePreparedCommand(
      command.command,
      project.id,
      signal,
      {
        conversationId: "conversation-command",
        conversationTitle: "终端 Agent",
        runId: "run-command",
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    const changePromise = tools.applyPreparedChange(
      change.change,
      project.id,
      signal,
      {
        conversationId: "conversation-file",
        conversationTitle: "文件 Agent",
        runId: "run-file",
      },
    );
    const [commandResult, changeResult] = await Promise.allSettled([commandPromise, changePromise]);

    expect(commandResult).toMatchObject({ status: "fulfilled", value: { isError: false } });
    expect(changeResult).toMatchObject({
      status: "fulfilled",
      value: { isError: true },
    });
    if (changeResult.status !== "fulfilled") throw changeResult.reason;
    expect(changeResult.value.content).toContain("PROJECT_OPERATION_CONFLICT");
    expect(changeResult.value.content).toContain("终端 Agent");
    await expect(readFile(path.join(project.rootPath, "command-target.txt"), "utf8")).resolves.toBe(
      "command",
    );
  });

  it("cancels an operation wait without affecting the owner or later changes", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const commandSignal = new AbortController().signal;
    const waitController = new AbortController();
    const command = await tools.execute(
      "run_command",
      JSON.stringify({ command: "Start-Sleep -Milliseconds 250; Write-Output done", timeoutMs: 10_000 }),
      project.id,
      commandSignal,
    );
    const followingChange = await tools.execute(
      "write_file",
      JSON.stringify({ content: "following\n", path: "following.txt" }),
      project.id,
      commandSignal,
    );
    if (
      command.kind !== "command"
      || followingChange.kind !== "change"
    ) {
      throw new Error("Expected one command and one file change proposal.");
    }

    const commandPromise = tools.executePreparedCommand(
      command.command,
      project.id,
      commandSignal,
      {
        conversationId: "conversation-owner",
        conversationTitle: "占用 Agent",
        runId: "run-owner",
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    const operations = await tools.execute(
      "list_project_operations",
      "{}",
      project.id,
      commandSignal,
      {
        conversationId: "conversation-waiter",
        conversationTitle: "等待 Agent",
        runId: "run-waiter",
      },
    );
    const operationPayload = JSON.parse(operations.content) as {
      value: { operations: Array<{ operationId: string }> };
    };
    const operationId = operationPayload.value.operations[0]?.operationId;
    if (operationId === undefined) throw new Error("Expected an active operation.");
    const waitPromise = tools.execute(
      "wait_for_project_operation",
      JSON.stringify({ operationId, timeoutMs: 10_000 }),
      project.id,
      waitController.signal,
    );
    const waitResult = waitPromise.then(
      () => null,
      (reason: unknown) => reason,
    );
    waitController.abort();

    await expect(commandPromise).resolves.toMatchObject({ isError: false });
    await expect(waitResult).resolves.toMatchObject({ name: "AbortError" });
    await expect(
      tools.applyPreparedChange(followingChange.change, project.id, commandSignal),
    ).resolves.toMatchObject({ isError: false });
    await expect(readFile(path.join(project.rootPath, "following.txt"), "utf8")).resolves.toBe(
      "following\n",
    );
  });
});
