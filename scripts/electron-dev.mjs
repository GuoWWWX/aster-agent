import { execFile, execFileSync, spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createElectronEnvironment, desktopBuildFingerprint, verifyDevRenderer } from "./electron-launch-config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = path.join(repositoryRoot, "apps", "desktop");
const distDirectory = path.join(desktopDirectory, "dist");
const requireFromDesktop = createRequire(path.join(desktopDirectory, "package.json"));
const electronExecutable = requireFromDesktop("electron");
// 默认端口服务于常规 `pnpm dev`；并行 worktree 可显式传入自己的 Vite 地址，
// 绝不能让 Electron 静默挂到另一个 worktree 的 Renderer 上。
const electronEnvironment = createElectronEnvironment("dev");
const rendererUrl = electronEnvironment.ELECTRON_RENDERER_URL;
const electronArguments = process.argv.slice(2);
await verifyDevRenderer(rendererUrl, repositoryRoot);
console.log(`[electron-dev] 开发模式 · ${rendererUrl} · React/CSS 热更新；仅 Main/Preload 构建变化会重启。`);
const sourceBranch = execFileSync("git", ["-C", repositoryRoot, "branch", "--show-current"], { encoding: "utf8" }).trim();
const sourceCommit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim().length > 0;
console.log(`[electron-dev] 源码 ${repositoryRoot} · ${sourceBranch || "detached"}@${sourceCommit}${sourceDirty ? "（含未提交修改）" : ""}`);

let child = null;
let isShuttingDown = false;
let isRestarting = false;
let restartTimer = null;
let runningBuildFingerprint = desktopBuildFingerprint(distDirectory);

function launchElectron() {
  child = spawn(electronExecutable, [".", ...electronArguments], {
    cwd: desktopDirectory,
    env: electronEnvironment,
    stdio: "inherit",
  });
  console.log(`[electron-dev] Electron PID=${child.pid}`);
  const launchedChild = child;
  launchedChild.once("error", (error) => {
    console.error("[electron-dev] Electron 启动失败。", error);
    shutdown();
    process.exitCode = 1;
  });
  launchedChild.once("exit", (code, signal) => {
    if (child !== launchedChild) return;
    child = null;
    if (isShuttingDown) return;
    if (isRestarting) return;
    watcher.close();
    process.exitCode = code ?? (signal === null ? 0 : 1);
  });
}

function stopProcessTree(runningChild) {
  if (process.platform !== "win32") {
    runningChild.kill("SIGTERM");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(runningChild.pid), "/t", "/f"], () => resolve());
  });
}

async function restartElectron() {
  if (child === null || isShuttingDown || isRestarting) return;
  const runningChild = child;
  isRestarting = true;
  await stopProcessTree(runningChild);
  isRestarting = false;
  if (isShuttingDown) return;

  // taskkill 的回调先于 Node 收到 child 的 exit 事件时，仍由这里接管重启；
  // 旧 child 的迟到 exit 回调会因引用已替换而被忽略。
  if (child === runningChild) child = null;
  launchElectron();
}

function scheduleRestart(changedPath) {
  if (!changedPath.endsWith(".cjs")) return;
  if (restartTimer !== null) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    const nextFingerprint = desktopBuildFingerprint(distDirectory);
    if (nextFingerprint === null || nextFingerprint === runningBuildFingerprint) return;
    runningBuildFingerprint = nextFingerprint;
    console.log("[electron-dev] Main/Preload 已重新构建，正在重启 Electron。");
    void restartElectron();
  }, 150);
}

const watcher = watch(distDirectory, { recursive: true }, (_eventType, fileName) => {
  if (typeof fileName === "string") scheduleRestart(fileName);
});

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  watcher.close();
  if (restartTimer !== null) clearTimeout(restartTimer);
  if (child === null) return;
  void stopProcessTree(child);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
launchElectron();
