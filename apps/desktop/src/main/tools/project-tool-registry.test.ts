import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "../projects/project-registry.js";
import { decodeTerminalOutput, ProjectToolRegistry } from "./project-tool-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
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
  return { project, tools: new ProjectToolRegistry(projects) };
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
      "wait_for_commands",
      "stop_command",
      "list_directory",
      "read_file",
      "search_text",
      "find_files",
      "write_file",
      "delete_file",
      "replace_in_file",
      "apply_patch",
      "run_command"
    ]);
  });

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
    await expect(
      tools.applyPreparedChange(proposal.change, project.id, new AbortController().signal)
    ).rejects.toThrow("changed after the diff was generated");
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

  it("decodes native Windows terminal output with the default terminal", async () => {
    if (process.platform !== "win32") return;

    const { project, tools } = await createFixture();
    const proposal = await tools.execute(
      "run_command",
      JSON.stringify({
        command: 'Write-Output "中文终端"; ping 127.0.0.1 -n 1',
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
    await expect(readFile(path.join(project.rootPath, "src", "index.ts"), "utf8")).resolves.toMatch(
      /^(?:first|second)\nbeta alpha\n$/,
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
