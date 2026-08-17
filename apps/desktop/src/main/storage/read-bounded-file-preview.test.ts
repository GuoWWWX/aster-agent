import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readBoundedFilePreview } from "./read-bounded-file-preview.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

async function createFile(contents: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-preview-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "preview.bin");
  await writeFile(filePath, contents);
  return filePath;
}

describe("readBoundedFilePreview", () => {
  it("returns an empty non-binary preview", async () => {
    const filePath = await createFile("");
    await expect(readBoundedFilePreview(filePath, 4)).resolves.toEqual({
      byteLength: 0,
      content: "",
      isBinary: false,
      truncated: false,
    });
  });

  it("detects NUL bytes and invalid UTF-8 without decoding them", async () => {
    const nulPath = await createFile(new Uint8Array([65, 0, 66]));
    await expect(readBoundedFilePreview(nulPath, 10)).resolves.toMatchObject({
      byteLength: 3,
      content: null,
      isBinary: true,
      truncated: false,
    });

    const invalidUtf8Path = await createFile(new Uint8Array([0xc3, 0x28]));
    await expect(readBoundedFilePreview(invalidUtf8Path, 10)).resolves.toMatchObject({
      byteLength: 2,
      content: null,
      isBinary: true,
      truncated: false,
    });
  });

  it("keeps the exact byte limit and marks longer files as truncated", async () => {
    const filePath = await createFile("abcdef");
    await expect(readBoundedFilePreview(filePath, 6)).resolves.toEqual({
      byteLength: 6,
      content: "abcdef",
      isBinary: false,
      truncated: false,
    });
    await expect(readBoundedFilePreview(filePath, 4)).resolves.toEqual({
      byteLength: 6,
      content: "abcd",
      isBinary: false,
      truncated: true,
    });
  });
});
