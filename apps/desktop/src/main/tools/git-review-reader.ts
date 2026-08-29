import { spawn } from "node:child_process";

import {
  gitFileDiffSchema,
  gitReviewSnapshotSchema,
  type GitBranch,
  type GitFileDiff,
  type GitFileDiffInput,
  type GitOperationInput,
  type GitReviewInput,
  type GitReviewSnapshot,
  type GitWorkingTreeChange,
} from "@agent/protocol";

import { ProjectRegistry } from "../projects/project-registry.js";

const GIT_OUTPUT_LIMIT_BYTES = 2_000_000;
const GIT_TIMEOUT_MS = 30_000;

type GitCommandResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  truncated: boolean;
};

type GitCommandRunner = (
  workingDirectory: string,
  args: readonly string[],
) => Promise<GitCommandResult>;

type LineStats = { additions: number | null; deletions: number | null };

export class GitReviewReader {
  public constructor(
    private readonly projects: Pick<ProjectRegistry, "getProject">,
    private readonly runGit: GitCommandRunner = runGitCommand,
  ) {}

  public async getSnapshot(input: GitReviewInput): Promise<GitReviewSnapshot> {
    const project = this.projects.getProject(input.projectId);
    const repositoryRoot = await this.getRepositoryRoot(project.rootPath);
    if (repositoryRoot === null) {
      return gitReviewSnapshotSchema.parse({
        ahead: 0,
        behind: 0,
        branch: null,
        branches: [],
        changes: [],
        isRepository: false,
        projectId: input.projectId,
        refreshedAt: new Date().toISOString(),
        upstream: null,
      });
    }

    const [branchResult, upstreamResult, statusResult, branchesResult, statsResult] = await Promise.all([
      this.runGit(repositoryRoot, ["symbolic-ref", "--short", "-q", "HEAD"]),
      this.runGit(repositoryRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
      this.runGit(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      this.runGit(repositoryRoot, [
        "for-each-ref",
        "--format=%(refname:short)%09%(upstream:short)%09%(HEAD)",
        "refs/heads",
      ]),
      this.runGit(repositoryRoot, ["diff", "--numstat", "--no-renames", "-z", "HEAD", "--"]),
    ]);
    assertGitSucceeded(statusResult, "无法读取 Git 工作区状态");
    assertGitSucceeded(branchesResult, "无法读取 Git 分支");

    const branch = branchResult.exitCode === 0 ? nonEmpty(branchResult.stdout) : null;
    const upstream = upstreamResult.exitCode === 0 ? nonEmpty(upstreamResult.stdout) : null;
    const divergence = upstream === null
      ? { ahead: 0, behind: 0 }
      : await this.readDivergence(repositoryRoot);
    const changes = parsePorcelainStatus(statusResult.stdout);
    const trackedStats = statsResult.exitCode === 0
      ? parseNumstat(statsResult.stdout)
      : new Map<string, LineStats>();
    const changesWithStats = await Promise.all(changes.map(async (change) => {
      const tracked = combineStats(
        trackedStats.get(change.path),
        change.originalPath === null ? undefined : trackedStats.get(change.originalPath),
      );
      const stats = change.status === "??"
        ? await this.readUntrackedStats(repositoryRoot, change.path)
        : tracked;
      return { ...change, ...stats };
    }));

    return gitReviewSnapshotSchema.parse({
      ...divergence,
      branch,
      branches: parseBranches(branchesResult.stdout),
      changes: changesWithStats,
      isRepository: true,
      projectId: input.projectId,
      refreshedAt: new Date().toISOString(),
      upstream,
    });
  }

  public async getFileDiff(input: GitFileDiffInput): Promise<GitFileDiff> {
    const project = this.projects.getProject(input.projectId);
    const repositoryRoot = await this.requireRepositoryRoot(project.rootPath);
    const status = await this.runGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      input.path,
    ]);
    assertGitSucceeded(status, "无法读取文件状态");
    const change = parsePorcelainStatus(status.stdout).find((item) => item.path === input.path);
    if (change === undefined) throw new Error("该文件当前没有未提交变更。");

    const contextLines = input.contextLines ?? 3;
    const result = change.status === "??"
      ? await this.runGit(repositoryRoot, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        `--unified=${contextLines}`,
        "--no-index",
        "--",
        "/dev/null",
        input.path,
      ])
      : await this.runGit(repositoryRoot, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        `--unified=${contextLines}`,
        "HEAD",
        "--",
        input.path,
      ]);
    if (result.exitCode !== 0 && !(change.status === "??" && result.exitCode === 1)) {
      assertGitSucceeded(result, "无法读取文件差异");
    }
    return gitFileDiffSchema.parse({
      content: result.stdout,
      path: input.path,
      truncated: result.truncated,
    });
  }

  public async runOperation(input: GitOperationInput): Promise<GitReviewSnapshot> {
    const project = this.projects.getProject(input.projectId);
    const repositoryRoot = await this.requireRepositoryRoot(project.rootPath);
    switch (input.action) {
      case "stageAll":
        await this.runChecked(repositoryRoot, ["add", "--all", "--"], "无法暂存全部变更");
        break;
      case "unstageAll":
        await this.runChecked(repositoryRoot, ["restore", "--staged", "--", "."], "无法取消暂存全部变更");
        break;
      case "untrackFiles":
        await this.runChecked(
          repositoryRoot,
          ["rm", "--cached", "--", ...input.paths],
          "无法取消跟踪已选文件",
        );
        break;
      case "stageFiles":
        await this.runChecked(repositoryRoot, ["add", "--", ...input.paths], "无法暂存已选文件");
        break;
      case "stageFile":
        await this.runChecked(repositoryRoot, ["add", "--", input.path], "无法暂存文件");
        break;
      case "unstageFile":
        await this.runChecked(repositoryRoot, ["restore", "--staged", "--", input.path], "无法取消暂存文件");
        break;
      case "switchBranch": {
        const branches = await this.readBranches(repositoryRoot);
        if (!branches.some((branch) => branch.name === input.branch)) {
          throw new Error("要切换的本地分支不存在。");
        }
        await this.runChecked(repositoryRoot, ["switch", "--", input.branch], "无法切换分支");
        break;
      }
      case "createBranch": {
        await this.runChecked(repositoryRoot, ["check-ref-format", "--branch", input.branch], "分支名称无效");
        if (input.startPoint !== undefined) {
          const branches = await this.readBranches(repositoryRoot);
          if (!branches.some((branch) => branch.name === input.startPoint)) {
            throw new Error("创建分支所依据的本地分支不存在。");
          }
        }
        await this.runChecked(
          repositoryRoot,
          input.startPoint === undefined
            ? ["switch", "-c", input.branch]
            : ["switch", "-c", input.branch, "--", input.startPoint],
          "无法创建分支",
        );
        break;
      }
      case "commit":
        await this.runChecked(repositoryRoot, ["add", "--", ...input.paths], "无法暂存已选文件");
        await this.runChecked(
          repositoryRoot,
          ["commit", "--only", "-m", input.message, "--", ...input.paths],
          "无法提交已选文件",
        );
        break;
      case "pull":
        await this.runChecked(repositoryRoot, ["pull", "--ff-only"], "无法拉取远程更新");
        break;
      case "push":
        await this.push(repositoryRoot);
        break;
    }
    return this.getSnapshot({ projectId: input.projectId });
  }

  private async getRepositoryRoot(workingDirectory: string): Promise<string | null> {
    const result = await this.runGit(workingDirectory, ["rev-parse", "--show-toplevel"]);
    return result.exitCode === 0 ? nonEmpty(result.stdout) : null;
  }

  private async requireRepositoryRoot(workingDirectory: string): Promise<string> {
    const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
    if (repositoryRoot === null) throw new Error("当前项目目录不是 Git 仓库。");
    return repositoryRoot;
  }

  private async readBranches(workingDirectory: string): Promise<GitBranch[]> {
    const result = await this.runGit(workingDirectory, [
      "for-each-ref",
      "--format=%(refname:short)%09%(upstream:short)%09%(HEAD)",
      "refs/heads",
    ]);
    assertGitSucceeded(result, "无法读取 Git 分支");
    return parseBranches(result.stdout);
  }

  private async readDivergence(workingDirectory: string): Promise<{ ahead: number; behind: number }> {
    const result = await this.runGit(workingDirectory, [
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...@{upstream}",
    ]);
    if (result.exitCode !== 0) return { ahead: 0, behind: 0 };
    const [ahead = 0, behind = 0] = result.stdout.trim().split(/\s+/u).map(Number);
    return {
      ahead: Number.isSafeInteger(ahead) && ahead >= 0 ? ahead : 0,
      behind: Number.isSafeInteger(behind) && behind >= 0 ? behind : 0,
    };
  }

  private async readUntrackedStats(workingDirectory: string, path: string): Promise<LineStats> {
    const result = await this.runGit(workingDirectory, [
      "diff",
      "--numstat",
      "--no-index",
      "--",
      "/dev/null",
      path,
    ]);
    if (result.exitCode !== 0 && result.exitCode !== 1) return { additions: null, deletions: null };
    return parseSingleNumstat(result.stdout);
  }

  private async push(workingDirectory: string): Promise<void> {
    const upstream = await this.runGit(workingDirectory, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (upstream.exitCode === 0) {
      await this.runChecked(workingDirectory, ["push"], "无法推送远程更新");
      return;
    }
    const branchResult = await this.runGit(workingDirectory, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = branchResult.exitCode === 0 ? nonEmpty(branchResult.stdout) : null;
    if (branch === null) throw new Error("当前处于 detached HEAD，无法自动设置远程分支。");
    await this.runChecked(workingDirectory, ["remote", "get-url", "origin"], "未配置 origin 远程仓库");
    await this.runChecked(
      workingDirectory,
      ["push", "--set-upstream", "origin", branch],
      "无法推送远程更新",
    );
  }

  private async runChecked(
    workingDirectory: string,
    args: readonly string[],
    message: string,
  ): Promise<void> {
    assertGitSucceeded(await this.runGit(workingDirectory, args), message);
  }
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseBranches(output: string): GitBranch[] {
  return output.split(/\r?\n/u).flatMap((line) => {
    if (line.length === 0) return [];
    const [name = "", upstream = "", marker = ""] = line.split("\t");
    if (name.length === 0) return [];
    return [{ current: marker === "*", name, upstream: nonEmpty(upstream) }];
  });
}

function parsePorcelainStatus(output: string): Omit<GitWorkingTreeChange, "additions" | "deletions">[] {
  const records = output.split("\0");
  const changes: Omit<GitWorkingTreeChange, "additions" | "deletions">[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3).replaceAll("\\", "/");
    const isRenameOrCopy = status.includes("R") || status.includes("C");
    const originalPath = isRenameOrCopy ? records[index + 1]?.replaceAll("\\", "/") ?? null : null;
    if (isRenameOrCopy) index += 1;
    changes.push({
      isStaged: status[0] !== " " && status[0] !== "?",
      originalPath,
      path,
      status,
    });
  }
  return changes;
}

function parseNumstat(output: string): Map<string, LineStats> {
  const stats = new Map<string, LineStats>();
  for (const record of output.split("\0")) {
    if (record.length === 0) continue;
    const [added = "-", deleted = "-", ...pathParts] = record.split("\t");
    const path = pathParts.join("\t").replaceAll("\\", "/");
    if (path.length === 0) continue;
    stats.set(path, parseStatValues(added, deleted));
  }
  return stats;
}

function parseSingleNumstat(output: string): LineStats {
  const [line = ""] = output.split(/\r?\n/u);
  const [added = "-", deleted = "-"] = line.split("\t");
  return parseStatValues(added, deleted);
}

function parseStatValues(added: string, deleted: string): LineStats {
  const additions = Number(added);
  const deletions = Number(deleted);
  return {
    additions: Number.isSafeInteger(additions) && additions >= 0 ? additions : null,
    deletions: Number.isSafeInteger(deletions) && deletions >= 0 ? deletions : null,
  };
}

function combineStats(first?: LineStats, second?: LineStats): LineStats {
  if (first === undefined && second === undefined) return { additions: 0, deletions: 0 };
  if (first?.additions === null || second?.additions === null) {
    return { additions: null, deletions: null };
  }
  return {
    additions: (first?.additions ?? 0) + (second?.additions ?? 0),
    deletions: (first?.deletions ?? 0) + (second?.deletions ?? 0),
  };
}

function assertGitSucceeded(result: GitCommandResult, message: string): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim();
  throw new Error(detail.length === 0 ? message : `${message}：${detail}`);
}

function runGitCommand(
  workingDirectory: string,
  args: readonly string[],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", workingDirectory, ...args], {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    const append = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
      const remaining = GIT_OUTPUT_LIMIT_BYTES - currentBytes;
      if (remaining <= 0) {
        truncated = true;
        return currentBytes;
      }
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        truncated = true;
        return GIT_OUTPUT_LIMIT_BYTES;
      }
      chunks.push(chunk);
      return currentBytes + chunk.byteLength;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = append(stderr, chunk, stderrBytes);
    });
    child.once("error", reject);
    const timeout = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
        truncated,
      });
    });
  });
}
