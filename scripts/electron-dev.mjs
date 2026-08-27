import { execFile, spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = path.join(repositoryRoot, "apps", "desktop");
const distDirectory = path.join(desktopDirectory, "dist");
const requireFromDesktop = createRequire(path.join(desktopDirectory, "package.json"));
const electronExecutable = requireFromDesktop("electron");

let child = null;
let isShuttingDown = false;
let isRestarting = false;
let restartTimer = null;

function launchElectron() {
  child = spawn(electronExecutable, ["."], {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
    },
    stdio: "inherit",
  });
  const launchedChild = child;
  launchedChild.once("exit", (code, signal) => {
    if (child !== launchedChild) return;
    child = null;
    if (isShuttingDown) return;
    if (isRestarting) return;
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
  if (child === null) return;
  void stopProcessTree(child);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
launchElectron();
