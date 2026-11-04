import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CancellationError, type CancellationToken } from "builder-util-runtime";
import { z } from "zod";
import { createDifferentialSteps, validateUpdateSteps } from "./update-blockmap.js";

const stepSchema = z.object({ kind: z.enum(["copy", "download"]), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict();
const planSchema = z.object({
  sha512: z.string(), url: z.string().url(), size: z.number().int().positive(),
  mode: z.enum(["full", "differential"]), steps: z.array(stepSchema).min(1).max(200_000),
  old: z.object({ path: z.string(), size: z.number().int().positive(), mtimeMs: z.number() }).strict().nullable(),
}).strict();
type UpdatePlan = z.infer<typeof planSchema>;

export type UpdateTransferProgress = {
  mode: "full" | "differential";
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type UpdateTransferInput = {
  cacheDirectory: string;
  url: URL;
  sha512: string;
  size: number;
  oldFile: string;
  oldMapUrl: URL;
  newMapUrl: URL;
  request: typeof fetch;
  cancellationToken: CancellationToken;
  onProgress: (progress: UpdateTransferProgress) => void;
};

class RangeUnsupportedError extends Error {}
class ChecksumMismatchError extends Error {}
class OldInstallerUnavailableError extends Error {}

function cacheKey(sha512: string): string {
  const bytes = Buffer.from(sha512, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== sha512) throw new Error("更新校验信息无效。");
  return bytes.toString("hex");
}

function cachePaths(directory: string, sha512: string): { partial: string; plan: string } {
  const key = cacheKey(sha512);
  return { partial: path.join(directory, `${key}.partial`), plan: path.join(directory, `${key}.json`) };
}

async function removeCache(paths: { partial: string; plan: string }): Promise<void> {
  await Promise.all([rm(paths.partial, { force: true }), rm(paths.plan, { force: true })]);
}

export async function hasPartialUpdate(directory: string, sha512: string): Promise<boolean> {
  try {
    const paths = cachePaths(directory, sha512);
    const [file, plan] = await Promise.all([stat(paths.partial), readFile(paths.plan, "utf8")]);
    return file.isFile() && file.size > 0 && planSchema.safeParse(JSON.parse(plan) as unknown).success;
  } catch { return false; }
}

async function existingOldFile(file: string): Promise<UpdatePlan["old"]> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0 ? { path: file, size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function fullPlan(input: UpdateTransferInput): UpdatePlan {
  return { sha512: input.sha512, url: input.url.toString(), size: input.size, mode: "full", old: null,
    steps: [{ kind: "download", start: 0, end: input.size }] };
}

async function choosePlan(input: UpdateTransferInput, signal: AbortSignal): Promise<UpdatePlan> {
  const old = await existingOldFile(input.oldFile);
  if (old !== null) {
    try {
      const steps = await createDifferentialSteps({ oldMapUrl: input.oldMapUrl, newMapUrl: input.newMapUrl,
        oldSize: old.size, newSize: input.size, request: input.request, signal });
      const downloadSize = steps.filter((step) => step.kind === "download").reduce((sum, step) => sum + step.end - step.start, 0);
      if (downloadSize < input.size) return { sha512: input.sha512, url: input.url.toString(), size: input.size,
        mode: "differential", old, steps };
    } catch (error) {
      if (signal.aborted) throw new CancellationError();
      // Old versions or servers without a usable blockmap use a verified full download.
      void error;
    }
  }
  return fullPlan(input);
}

async function loadPlan(input: UpdateTransferInput, paths: { partial: string; plan: string }, signal: AbortSignal): Promise<UpdatePlan> {
  try {
    const plan = planSchema.parse(JSON.parse(await readFile(paths.plan, "utf8")) as unknown);
    if (plan.sha512 !== input.sha512 || plan.url !== input.url.toString() || plan.size !== input.size) throw new Error("stale plan");
    const old = await existingOldFile(input.oldFile);
    if (plan.old !== null && (old === null || plan.old.path !== old.path || plan.old.size !== old.size || plan.old.mtimeMs !== old.mtimeMs)) {
      throw new Error("stale installer");
    }
    validateUpdateSteps(plan.steps, plan.size, old?.size ?? 0);
    const partial = await stat(paths.partial);
    if (!partial.isFile() || partial.size > input.size) throw new Error("invalid partial file");
    return plan;
  } catch {
    if (signal.aborted) throw new CancellationError();
    await removeCache(paths);
    const plan = await choosePlan(input, signal);
    await writeFile(`${paths.plan}.tmp`, JSON.stringify(plan), "utf8");
    await rename(`${paths.plan}.tmp`, paths.plan);
    return plan;
  }
}

async function sha512File(file: string, token: CancellationToken): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) {
    if (token.cancelled) throw new CancellationError();
    hash.update(chunk as Buffer);
  }
  return hash.digest("base64");
}

async function runPlan(input: UpdateTransferInput, plan: UpdatePlan, partial: string, signal: AbortSignal): Promise<void> {
  const previous = await stat(partial).catch(() => null);
  let written = previous?.size ?? 0;
  let targetPosition = 0;
  let downloaded = 0;
  let downloadTotal = 0;
  for (const step of plan.steps) {
    const length = step.end - step.start;
    if (step.kind === "download") {
      downloadTotal += length;
      downloaded += Math.max(0, Math.min(length, written - targetPosition));
    }
    targetPosition += length;
  }
  let sessionDownloaded = 0;
  const started = Date.now();
  let lastReport = 0;
  const report = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastReport < 250) return;
    lastReport = now;
    input.onProgress({ mode: plan.mode, transferred: downloadTotal === 0 && written === input.size ? 1 : downloaded,
      total: Math.max(1, downloadTotal), bytesPerSecond: Math.round(sessionDownloaded * 1000 / Math.max(1, now - started)) });
  };
  const output = await open(partial, previous === null ? "w" : "r+");
  let old: Awaited<ReturnType<typeof open>> | null = null;
  const writeChunk = async (chunk: Uint8Array): Promise<void> => {
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (signal.aborted) throw new CancellationError();
      const result = await output.write(chunk, offset, chunk.byteLength - offset, written);
      if (result.bytesWritten === 0) throw new Error("更新文件写入失败。");
      offset += result.bytesWritten;
      written += result.bytesWritten;
    }
  };
  try {
    if (plan.old !== null) {
      try { old = await open(plan.old.path, "r"); } catch { throw new OldInstallerUnavailableError(); }
    }
    report(true);
    let targetOffset = 0;
    for (const step of plan.steps) {
      const length = step.end - step.start;
      if (written >= targetOffset + length) { targetOffset += length; continue; }
      const already = Math.max(0, written - targetOffset);
      const start = step.start + already;
      if (signal.aborted) throw new CancellationError();
      if (step.kind === "copy") {
        if (old === null) throw new OldInstallerUnavailableError();
        let source = start;
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        while (source < step.end) {
          const result = await old.read(buffer, 0, Math.min(buffer.length, step.end - source), source)
            .catch(() => { throw new OldInstallerUnavailableError(); });
          if (result.bytesRead === 0) throw new OldInstallerUnavailableError();
          await writeChunk(buffer.subarray(0, result.bytesRead));
          source += result.bytesRead;
          report();
        }
      } else {
        const response = await input.request(input.url, { signal, headers: { Range: `bytes=${start}-${step.end - 1}` } });
        if (response.status === 200 && (start !== 0 || step.end !== input.size)) {
          await response.body?.cancel();
          throw new RangeUnsupportedError();
        }
        if (response.status !== 200 && response.status !== 206) throw new Error(`更新下载失败（HTTP ${response.status}）。`);
        if (response.status === 206) {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("content-range") ?? "");
          if (match === null || Number(match[1]) !== start || Number(match[2]) !== step.end - 1 || Number(match[3]) !== input.size) {
            throw new Error("更新服务器返回了错误的下载范围。");
          }
        }
        if (response.body === null) throw new Error("更新下载响应为空。");
        let received = 0;
        for await (const chunk of response.body) {
          received += chunk.byteLength;
          if (received > step.end - start) throw new Error("更新下载数据超出预期。");
          await writeChunk(chunk);
          downloaded += chunk.byteLength;
          sessionDownloaded += chunk.byteLength;
          report();
        }
        if (received !== step.end - start) throw new Error("更新下载中断，可继续下载。");
      }
      targetOffset += length;
    }
    report(true);
  } finally {
    await output.close();
    await old?.close();
  }
}

export async function downloadResumableUpdate(input: UpdateTransferInput): Promise<{ file: string; cleanup: () => Promise<void> }> {
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new Error("更新文件大小无效。");
  const paths = cachePaths(input.cacheDirectory, input.sha512);
  await mkdir(input.cacheDirectory, { recursive: true });
  const abort = new AbortController();
  const cancel = (): void => abort.abort();
  if (input.cancellationToken.cancelled) cancel();
  else input.cancellationToken.once("cancel", cancel);
  try {
    let plan = await loadPlan(input, paths, abort.signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runPlan(input, plan, paths.partial, abort.signal);
        if (await sha512File(paths.partial, input.cancellationToken) !== input.sha512) throw new ChecksumMismatchError("更新文件校验失败。");
        return { file: paths.partial, cleanup: () => removeCache(paths) };
      } catch (error) {
        if (abort.signal.aborted || input.cancellationToken.cancelled) throw new CancellationError();
        const mustRetryFull = error instanceof RangeUnsupportedError || (plan.mode === "differential" &&
          (error instanceof ChecksumMismatchError || error instanceof OldInstallerUnavailableError));
        if (!mustRetryFull || attempt !== 0) {
          if (error instanceof ChecksumMismatchError) await removeCache(paths);
          throw error;
        }
        await removeCache(paths);
        plan = fullPlan(input);
        await writeFile(paths.plan, JSON.stringify(plan), "utf8");
      }
    }
    throw new Error("更新下载失败。");
  } finally {
    input.cancellationToken.removeListener("cancel", cancel);
  }
}
