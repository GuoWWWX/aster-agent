import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unpackedRipgrepPath } from "../apps/desktop/src/main/tools/bundled-ripgrep.ts";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows packaging must be verified on Windows x64.");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = path.join(repositoryRoot, "apps/desktop");
const packaged = process.argv.includes("--packaged");
const packageDirectory = packaged ? path.join(repositoryRoot, "release/win-unpacked/resources/app.asar") : desktopDirectory;
const electron = packaged ? path.join(repositoryRoot, "release/win-unpacked/Aster.exe")
  : createRequire(path.join(desktopDirectory, "package.json"))("electron");
// node-pty 1.1 uses Node-API prebuilds. Verify the actual Electron runtime before
// packaging those binaries instead of compiling them against the host Node ABI.
const result = spawnSync(electron, ["--eval", `
  const appRequire = require("node:module").createRequire(${JSON.stringify(path.join(packageDirectory, "package.json"))});
  const pty = appRequire("node-pty");
  const resolveBinary = ${unpackedRipgrepPath.toString()};
  const rgPath = resolveBinary(appRequire("@vscode/ripgrep").rgPath);
  const rg = require("node:child_process").spawnSync(rgPath, ["--version"], {encoding:"utf8", windowsHide:true});
  if (rg.status !== 0) { console.error("Packaged ripgrep failed", rg.error); process.exit(1); }
  const renderer = ${packaged} ? require("node:fs").existsSync(${JSON.stringify(path.join(packageDirectory, "renderer/index.html"))}) : true;
  if (!renderer) { console.error("Packaged Renderer missing"); process.exit(1); }
  let output = "";
  const timeout = setTimeout(() => { console.error("PTY verification timed out"); process.exit(1); }, 15000);
  const terminal = pty.spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "echo ASTER_NATIVE_OK"], {
    cwd: process.cwd(), env: process.env, cols: 80, rows: 24,
  });
  terminal.onData(data => { output += data; });
  terminal.onExit(({exitCode}) => {
    clearTimeout(timeout);
    const ok = exitCode === 0 && output.includes("ASTER_NATIVE_OK");
    console.log(JSON.stringify({ electron: process.versions.electron, nodeApi: process.versions.napi, pty: ok, ripgrep: true, renderer, packaged: ${packaged} }));
    process.exit(ok ? 0 : 1);
  });
`], {
  cwd: repositoryRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  encoding: "utf8",
  timeout: 20000,
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Native/runtime verification failed; do not package incompatible binaries.");
