import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export function workspaceId(repositoryRoot) {
  return createHash("sha256").update(realpathSync(repositoryRoot)).digest("hex");
}

export function createElectronEnvironment(mode, source = process.env) {
  if (mode !== "dev" && mode !== "preview") throw new Error(`Unknown Electron start mode: ${mode}`);
  const env = { ...source, ASTER_START_MODE: mode };
  delete env.ELECTRON_RUN_AS_NODE;
  if (mode === "dev") {
    env.ELECTRON_RENDERER_URL = new URL(source.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173").href;
  } else {
    delete env.ELECTRON_RENDERER_URL;
  }
  return env;
}

export async function verifyDevRenderer(rendererUrl, repositoryRoot, fetchRenderer = fetch) {
  let response;
  try {
    response = await fetchRenderer(rendererUrl, { signal: AbortSignal.timeout(5000) });
  } catch (cause) {
    throw new Error(`Vite unavailable at ${rendererUrl}. Run pnpm dev; development never falls back to dist.`, { cause });
  }
  if (!response.ok || response.headers.get("x-aster-workspace") !== workspaceId(repositoryRoot)) {
    throw new Error(`Vite at ${rendererUrl} does not belong to this worktree. Stop the other server or use an explicit ELECTRON_RENDERER_URL and matching Vite port.`);
  }
}

export function assertPreviewBuild(repositoryRoot) {
  for (const file of ["apps/desktop/dist/main/index.cjs", "apps/desktop/dist/preload/index.cjs", "apps/web/dist/index.html"]) {
    if (!existsSync(path.join(repositoryRoot, file))) throw new Error(`Missing ${file}. Run pnpm build before production preview.`);
  }
}

export function desktopBuildFingerprint(distDirectory) {
  if (!["main/index.cjs", "preload/index.cjs"].every((file) => existsSync(path.join(distDirectory, file)))) return null;
  const hash = createHash("sha256");
  try {
    for (const file of readdirSync(distDirectory, { recursive: true }).filter((file) => file.endsWith(".cjs")).sort()) {
      hash.update(file).update(readFileSync(path.join(distDirectory, file)));
    }
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return hash.digest("hex");
}
