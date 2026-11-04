import { gunzipSync } from "node:zlib";
import { computeOperations, OperationKind } from "electron-updater/out/differentialDownloader/downloadPlanBuilder.js";
import { z } from "zod";

export type UpdateStep = { kind: "copy" | "download"; start: number; end: number };

const blockMapSchema = z.object({
  version: z.enum(["1", "2"]),
  files: z.array(z.object({
    name: z.string().min(1).max(512),
    offset: z.number().int().nonnegative(),
    checksums: z.array(z.string().min(1).max(128)).max(200_000),
    sizes: z.array(z.number().int().positive()).max(200_000),
  })).length(1),
});

async function readBlockMap(url: URL, request: typeof fetch, signal: AbortSignal) {
  const response = await request(url, { signal });
  if (!response.ok || response.body === null) throw new Error("无法读取更新差量信息。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 10 * 1024 * 1024) throw new Error("更新差量信息过大。");
    chunks.push(chunk);
  }
  const data = gunzipSync(Buffer.concat(chunks), { maxOutputLength: 32 * 1024 * 1024 });
  return blockMapSchema.parse(JSON.parse(data.toString("utf8")) as unknown);
}

function validateMap(map: z.infer<typeof blockMapSchema>, size: number): void {
  const file = map.files[0];
  if (file === undefined || file.offset !== 0 || file.checksums.length !== file.sizes.length ||
      file.sizes.reduce((sum, value) => sum + value, 0) !== size) {
    throw new Error("更新差量信息与安装包不匹配。");
  }
}

/** Merge small unchanged gaps into neighboring downloads to avoid excessive GitHub range requests. */
function mergeSmallGaps(steps: UpdateStep[]): UpdateStep[] {
  const result: UpdateStep[] = [];
  let targetOffset = 0;
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    if (current === undefined) break;
    let length = current.end - current.start;
    if (current.kind === "download") {
      let end = targetOffset + length;
      while (steps[i + 1]?.kind === "copy" && steps[i + 2]?.kind === "download") {
        const gap = steps[i + 1]!;
        const next = steps[i + 2]!;
        const gapLength = gap.end - gap.start;
        if (gapLength > 8 * 1024) break;
        const nextLength = next.end - next.start;
        length += gapLength + nextLength;
        end += gapLength + nextLength;
        i += 2;
      }
      result.push({ kind: "download", start: targetOffset, end });
    } else result.push(current);
    targetOffset += length;
  }
  return result;
}

export async function createDifferentialSteps(input: {
  oldMapUrl: URL;
  newMapUrl: URL;
  oldSize: number;
  newSize: number;
  request: typeof fetch;
  signal: AbortSignal;
}): Promise<UpdateStep[]> {
  const [oldMap, newMap] = await Promise.all([
    readBlockMap(input.oldMapUrl, input.request, input.signal),
    readBlockMap(input.newMapUrl, input.request, input.signal),
  ]);
  validateMap(oldMap, input.oldSize);
  validateMap(newMap, input.newSize);
  if (oldMap.version !== newMap.version) throw new Error("更新差量格式不兼容。");
  const operations = computeOperations(oldMap, newMap, { info: () => undefined, warn: () => undefined, error: () => undefined });
  const steps: UpdateStep[] = operations.map((operation) => ({
    kind: operation.kind === OperationKind.COPY ? "copy" : "download",
    start: operation.start,
    end: operation.end,
  }));
  validateUpdateSteps(steps, input.newSize, input.oldSize);
  return mergeSmallGaps(steps);
}

export function validateUpdateSteps(steps: readonly UpdateStep[], newSize: number, oldSize: number): void {
  let targetOffset = 0;
  for (const step of steps) {
    const length = step.end - step.start;
    const limit = step.kind === "copy" ? oldSize : newSize;
    if (!Number.isSafeInteger(step.start) || !Number.isSafeInteger(step.end) || step.start < 0 ||
        length <= 0 || step.end > limit || (step.kind === "download" && step.start !== targetOffset)) {
      throw new Error("更新差量计划无效。");
    }
    targetOffset += length;
  }
  if (targetOffset !== newSize) throw new Error("更新差量计划大小不匹配。");
}
