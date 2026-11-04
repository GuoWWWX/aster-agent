import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPreviewBuild, createElectronEnvironment } from "./electron-launch-config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = path.join(repositoryRoot, "apps", "desktop");
assertPreviewBuild(repositoryRoot);
console.log("[electron-preview] 生产预览模式 · 本地 dist · 无热更新；开发请使用 pnpm dev。");
const electron = createRequire(path.join(desktopDirectory, "package.json"))("electron");
const child = spawn(electron, [".", ...process.argv.slice(2)], {
  cwd: desktopDirectory,
  env: createElectronEnvironment("preview"),
  stdio: "inherit",
});
child.once("error", (error) => { console.error("Electron preview failed.", error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
process.once("SIGINT", () => child.kill());
process.once("SIGTERM", () => child.kill());
