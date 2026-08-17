import { open, stat } from "node:fs/promises";

export type BoundedFilePreview = {
  byteLength: number;
  content: string | null;
  isBinary: boolean;
  truncated: boolean;
};

export async function readBoundedFilePreview(
  filePath: string,
  maxBytes: number,
): Promise<BoundedFilePreview> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new Error("A non-negative integer preview limit is required.");
  }
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) throw new Error("Requested path is not a file.");

  const previewLength = Math.min(fileInfo.size, maxBytes);
  const contents = Buffer.alloc(previewLength);
  const handle = await open(filePath, "r");
  let bytesRead = 0;
  try {
    while (bytesRead < previewLength) {
      const result = await handle.read(
        contents,
        bytesRead,
        previewLength - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
  } finally {
    await handle.close();
  }

  const readableContents = contents.subarray(0, bytesRead);
  let content: string | null = null;
  let isBinary = readableContents.includes(0);
  if (!isBinary) {
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(readableContents);
    } catch {
      isBinary = true;
    }
  }

  return {
    byteLength: fileInfo.size,
    content,
    isBinary,
    truncated: fileInfo.size > maxBytes,
  };
}
