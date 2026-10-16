import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const HTML_PREVIEW_MAX_BYTES = 1_000_000;

export async function containedPreviewPath(root: string, value: string): Promise<string> {
  const candidate = path.resolve(root, value);
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || relative.split(path.sep).some(segment => segment.startsWith(".") || segment.includes(":"))) throw new Error("预览资源超出允许目录。");
  const canonical = await realpath(candidate);
  const canonicalRelative = path.relative(root, canonical);
  if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)
    || canonicalRelative.split(path.sep).some(segment => segment.startsWith("."))) throw new Error("预览资源超出允许目录。");
  if (!(await stat(canonical)).isFile()) throw new Error("Preview target is not a file.");
  return canonical;
}

export async function readHtmlPreviewFile(root: string, relativePath: string): Promise<{ path: string; source: string }> {
  const file = await containedPreviewPath(await realpath(root), relativePath);
  if (!/\.html?$/iu.test(file)) throw new Error("只能预览 HTML 文件。");
  if ((await stat(file)).size > HTML_PREVIEW_MAX_BYTES) throw new Error("HTML 预览文件不能超过 1 MB。");
  const source = await readFile(file, "utf8");
  if (source.includes("\0") || Buffer.byteLength(source) > HTML_PREVIEW_MAX_BYTES) throw new Error("HTML 文件格式无效或过大。");
  return { path: file, source };
}
