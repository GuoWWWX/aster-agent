import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitReviewReader } from "./git-review-reader.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
  }
});

function result(stdout = "", exitCode = 0, stderr = "") {
  return { exitCode, stderr, stdout, truncated: false };
}

describe("GitReviewReader", () => {
  it("returns branches, divergence, staging state, and per-file line statistics", async () => {
    const runGit = vi.fn((_workingDirectory: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(result("D:/Agent\n"));
      if (command === "symbolic-ref --short -q HEAD") return Promise.resolve(result("develop\n"));
      if (command.includes("@{upstream}") && command.startsWith("rev-parse")) {
        return Promise.resolve(result("origin/develop\n"));
      }
      if (command.startsWith("status ")) {
        return Promise.resolve(result(" M src/app.ts\0R  src/new.ts\0src/old.ts\0?? notes.txt\0"));
      }
      if (command.startsWith("for-each-ref ")) {
        return Promise.resolve(result("develop\torigin/develop\t*\nfeature/demo\t\t \n"));
      }
      if (command === "diff --numstat --no-renames -z HEAD --") {
        return Promise.resolve(result("1\t2\tsrc/app.ts\u00003\t0\tsrc/new.ts\u00000\t4\tsrc/old.ts\u0000"));
      }
      if (command === "diff --numstat --no-index -- /dev/null notes.txt") {
        return Promise.resolve(result("5\t0\t/dev/null => notes.txt\n", 1));
      }
      if (command.startsWith("rev-list ")) return Promise.resolve(result("2\t3\n"));
      return Promise.reject(new Error(`Unexpected git command: ${command}`));
    });
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Agent", rootPath: "D:\\Agent" }) },
      runGit,
    );

    const snapshot = await reader.getSnapshot({ projectId });

    expect(snapshot).toMatchObject({
      ahead: 2,
      behind: 3,
      branch: "develop",
      branches: [
        { current: true, name: "develop", upstream: "origin/develop" },
        { current: false, name: "feature/demo", upstream: null },
      ],
      isRepository: true,
      upstream: "origin/develop",
    });
    expect(snapshot.changes).toEqual([
      {
        additions: 1,
        deletions: 2,
        isStaged: false,
        originalPath: null,
        path: "src/app.ts",
        status: " M",
      },
      {
        additions: 3,
        deletions: 4,
        isStaged: true,
        originalPath: "src/old.ts",
        path: "src/new.ts",
        status: "R ",
      },
      {
        additions: 5,
        deletions: 0,
        isStaged: false,
        originalPath: null,
        path: "notes.txt",
        status: "??",
      },
    ]);
  });

  it("returns the diff for one selected untracked file", async () => {
    const runGit = vi.fn((_workingDirectory: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(result("D:/Agent\n"));
      if (command.startsWith("status ")) return Promise.resolve(result("?? notes.txt\0"));
      if (command.includes("--no-index")) {
        return Promise.resolve(result("diff --git a/notes.txt b/notes.txt\n+hello\n", 1));
      }
      return Promise.reject(new Error(`Unexpected git command: ${command}`));
    });
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Agent", rootPath: "D:\\Agent" }) },
      runGit,
    );

    await expect(reader.getFileDiff({ path: "notes.txt", projectId })).resolves.toMatchObject({
      path: "notes.txt",
      truncated: false,
    });
  });

  it("uses the requested context size for an expanded diff", async () => {
    const runGit = vi.fn((_workingDirectory: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(result("D:/Agent\n"));
      if (command.startsWith("status ")) return Promise.resolve(result("?? notes.txt\0"));
      if (command.includes("--no-index")) return Promise.resolve(result("diff --git a/notes.txt b/notes.txt\n+hello\n", 1));
      return Promise.reject(new Error(`Unexpected git command: ${command}`));
    });
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Agent", rootPath: "D:\\Agent" }) },
      runGit,
    );

    await reader.getFileDiff({ contextLines: 120, path: "notes.txt", projectId });

    expect(runGit.mock.calls.some(([, args]) => args.includes("--unified=120"))).toBe(true);
  });

  it("does not switch to a branch outside the local branch list", async () => {
    const runGit = vi.fn((_workingDirectory: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(result("D:/Agent\n"));
      if (command.startsWith("for-each-ref ")) return Promise.resolve(result("develop\t\t*\n"));
      return Promise.reject(new Error(`Unexpected git command: ${command}`));
    });
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Agent", rootPath: "D:\\Agent" }) },
      runGit,
    );

    await expect(reader.runOperation({
      action: "switchBranch",
      branch: "missing",
      projectId,
    })).rejects.toThrow("本地分支不存在");
    expect(runGit).not.toHaveBeenCalledWith("D:/Agent", ["switch", "--", "missing"]);
  });

  it("creates a branch from an explicitly selected local branch", async () => {
    const runGit = vi.fn((_workingDirectory: string, args: readonly string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return Promise.resolve(result("D:/Agent\n"));
      if (command === "check-ref-format --branch feature/from-develop") return Promise.resolve(result());
      if (command.startsWith("for-each-ref ")) {
        return Promise.resolve(result("develop\torigin/develop\t*\nfeature/demo\t\t \n"));
      }
      if (command === "switch -c feature/from-develop -- develop") return Promise.resolve(result());
      if (command === "symbolic-ref --short -q HEAD") return Promise.resolve(result("feature/from-develop\n"));
      if (command.startsWith("rev-parse ") && command.includes("@{upstream}")) {
        return Promise.resolve(result("", 128));
      }
      if (command.startsWith("status ")) return Promise.resolve(result());
      if (command === "diff --numstat --no-renames -z HEAD --") return Promise.resolve(result());
      return Promise.reject(new Error(`Unexpected git command: ${command}`));
    });
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Agent", rootPath: "D:\\Agent" }) },
      runGit,
    );

    const snapshot = await reader.runOperation({
      action: "createBranch",
      branch: "feature/from-develop",
      projectId,
      startPoint: "develop",
    });

    expect(snapshot.branch).toBe("feature/from-develop");
    expect(runGit).toHaveBeenCalledWith("D:/Agent", [
      "switch",
      "-c",
      "feature/from-develop",
      "--",
      "develop",
    ]);
  });

  it("reports a registered non-repository without invoking status", async () => {
    const runGit = vi.fn(() => Promise.resolve(result("false\n", 128)));
    const reader = new GitReviewReader(
      { getProject: () => ({ id: projectId, name: "Folder", rootPath: "D:\\Folder" }) },
      runGit,
    );

    await expect(reader.getSnapshot({ projectId })).resolves.toMatchObject({
      branches: [],
      changes: [],
      isRepository: false,
    });
    expect(runGit).toHaveBeenCalledTimes(1);
  });

  it("reads and updates a real temporary repository", async () => {
    const rootPath = mkdtempSync(join(tmpdir(), "aster-git-review-"));
    temporaryDirectories.push(rootPath);
    const git = (...args: string[]): void => {
      execFileSync("git", ["-C", rootPath, ...args], { stdio: "ignore" });
    };
    git("init", "-b", "develop");
    git("config", "user.name", "Aster Test");
    git("config", "user.email", "aster@example.test");
    writeFileSync(join(rootPath, "tracked.txt"), "one\ntwo\n", "utf8");
    git("add", "tracked.txt");
    git("commit", "-m", "initial");
    writeFileSync(join(rootPath, "tracked.txt"), "one\nchanged\nthree\n", "utf8");
    writeFileSync(join(rootPath, "new.txt"), "new\nfile\n", "utf8");
    const projectRootPath = join(rootPath, "docs", "design-assets");
    mkdirSync(projectRootPath, { recursive: true });
    const reader = new GitReviewReader({
      getProject: () => ({ id: projectId, name: "Temp", rootPath: projectRootPath }),
    });

    const snapshot = await reader.getSnapshot({ projectId });
    expect(snapshot.branch).toBe("develop");
    expect(snapshot.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ additions: 2, deletions: 1, path: "tracked.txt" }),
      expect.objectContaining({ additions: 2, deletions: 0, path: "new.txt" }),
    ]));
    await expect(reader.getFileDiff({ path: "tracked.txt", projectId })).resolves.toMatchObject({
      path: "tracked.txt",
    });

    const staged = await reader.runOperation({ action: "stageFile", path: "new.txt", projectId });
    expect(staged.changes.find((change) => change.path === "new.txt")?.isStaged).toBe(true);
    const branched = await reader.runOperation({
      action: "createBranch",
      branch: "feature/review-test",
      projectId,
    });
    expect(branched.branch).toBe("feature/review-test");
    const switched = await reader.runOperation({
      action: "switchBranch",
      branch: "develop",
      projectId,
    });
    expect(switched.branch).toBe("develop");
    const basedBranch = await reader.runOperation({
      action: "createBranch",
      branch: "feature/based-review-test",
      projectId,
      startPoint: "develop",
    });
    expect(basedBranch.branch).toBe("feature/based-review-test");
  }, 15_000);

  it("stages and commits only selected paths without consuming unrelated staged work", async () => {
    const rootPath = mkdtempSync(join(tmpdir(), "aster-git-review-selected-"));
    temporaryDirectories.push(rootPath);
    const git = (...args: string[]): string => execFileSync("git", ["-C", rootPath, ...args], { encoding: "utf8" });
    git("init", "-b", "develop");
    git("config", "user.name", "Aster Test");
    git("config", "user.email", "aster@example.test");
    writeFileSync(join(rootPath, "tracked.txt"), "base\n", "utf8");
    git("add", "tracked.txt");
    git("commit", "-m", "initial");
    writeFileSync(join(rootPath, "selected.txt"), "selected\n", "utf8");
    writeFileSync(join(rootPath, "other-staged.txt"), "other\n", "utf8");
    git("add", "other-staged.txt");
    const reader = new GitReviewReader({
      getProject: () => ({ id: projectId, name: "Temp", rootPath }),
    });

    const staged = await reader.runOperation({ action: "stageFiles", paths: ["selected.txt"], projectId });
    expect(staged.changes.find((change) => change.path === "selected.txt")?.isStaged).toBe(true);

    await reader.runOperation({
      action: "commit",
      message: "commit selected",
      paths: ["selected.txt"],
      projectId,
    });

    expect(git("show", "--format=", "--name-only", "HEAD").trim()).toBe("selected.txt");
    expect(git("status", "--porcelain")).toContain("A  other-staged.txt");
  }, 15_000);

  it("removes selected files from Git tracking while preserving their local contents", async () => {
    const rootPath = mkdtempSync(join(tmpdir(), "aster-git-review-untrack-"));
    temporaryDirectories.push(rootPath);
    const git = (...args: string[]): string => execFileSync("git", ["-C", rootPath, ...args], { encoding: "utf8" });
    git("init", "-b", "develop");
    git("config", "user.name", "Aster Test");
    git("config", "user.email", "aster@example.test");
    writeFileSync(join(rootPath, "tracked.txt"), "base\n", "utf8");
    git("add", "tracked.txt");
    git("commit", "-m", "initial");
    writeFileSync(join(rootPath, "tracked.txt"), "changed\n", "utf8");
    const reader = new GitReviewReader({
      getProject: () => ({ id: projectId, name: "Temp", rootPath }),
    });

    await reader.runOperation({ action: "untrackFiles", paths: ["tracked.txt"], projectId });

    expect(readFileSync(join(rootPath, "tracked.txt"), "utf8")).toBe("changed\n");
    expect(() => git("ls-files", "--error-unmatch", "tracked.txt")).toThrow();
  }, 15_000);
});
