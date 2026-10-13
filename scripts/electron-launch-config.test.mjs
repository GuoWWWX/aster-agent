import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertPreviewBuild, createElectronEnvironment, desktopBuildFingerprint, verifyDevRenderer, workspaceId } from "./electron-launch-config.mjs";

test("development keeps HMR enabled and strips Electron's Node-only flag", () => {
  const original = { ELECTRON_RUN_AS_NODE: "1", PATH: "sample" };
  const env = createElectronEnvironment("dev", original);
  assert.equal(env.ASTER_START_MODE, "dev");
  assert.equal(env.ELECTRON_RENDERER_URL, "http://127.0.0.1:5173/");
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.PATH, "sample");
  assert.equal(original.ELECTRON_RUN_AS_NODE, "1");
});

test("production preview cannot inherit a development renderer", () => {
  const env = createElectronEnvironment("preview", { ELECTRON_RENDERER_URL: "http://127.0.0.1:5174", ELECTRON_RUN_AS_NODE: "1" });
  assert.equal(env.ASTER_START_MODE, "preview");
  assert.equal(env.ELECTRON_RENDERER_URL, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.throws(() => createElectronEnvironment("unknown", {}), /mode/);
});

test("development refuses another worktree's server and never falls back to dist", async () => {
  const fetchOther = async () => new Response("ok", { headers: { "x-aster-workspace": "another-worktree" } });
  await assert.rejects(verifyDevRenderer("http://127.0.0.1:5173", process.cwd(), fetchOther), /worktree/);
  const fetchUnavailable = async () => { throw new Error("connection refused"); };
  await assert.rejects(verifyDevRenderer("http://127.0.0.1:5173", process.cwd(), fetchUnavailable), /Vite/);
});

test("development accepts the matching worktree and preserves an explicit local port", async () => {
  const env = createElectronEnvironment("dev", { ELECTRON_RENDERER_URL: "http://127.0.0.1:5174" });
  assert.equal(env.ELECTRON_RENDERER_URL, "http://127.0.0.1:5174/");
  await verifyDevRenderer(env.ELECTRON_RENDERER_URL, process.cwd(), async () => new Response("ok", {
    headers: { "x-aster-workspace": workspaceId(process.cwd()) },
  }));
});

test("production preview fails clearly until both desktop and web are built", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aster-launch-test-"));
  try {
    assert.throws(() => assertPreviewBuild(root), /pnpm build/);
    for (const file of ["apps/desktop/dist/main/index.cjs", "apps/desktop/dist/preload/index.cjs", "apps/web/dist/index.html"]) {
      const absolute = path.join(root, file);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, "fixture");
    }
    assert.doesNotThrow(() => assertPreviewBuild(root));
  } finally { rmSync(root, { recursive: true }); }
});

test("identical desktop rebuilds and frontend changes do not trigger a restart", () => {
  const dist = mkdtempSync(path.join(os.tmpdir(), "aster-watch-test-"));
  try {
    assert.equal(desktopBuildFingerprint(dist), null);
    for (const file of ["main/index.cjs", "preload/index.cjs", "preload/browser-passwords.cjs"]) {
      mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
      writeFileSync(path.join(dist, file), "original");
    }
    const original = desktopBuildFingerprint(dist);
    writeFileSync(path.join(dist, "main/index.cjs"), "original");
    writeFileSync(path.join(dist, "frontend.css"), "changed");
    assert.equal(desktopBuildFingerprint(dist), original);
    writeFileSync(path.join(dist, "preload/index.cjs"), "changed preload");
    assert.notEqual(desktopBuildFingerprint(dist), original);
  } finally { rmSync(dist, { recursive: true }); }
});
