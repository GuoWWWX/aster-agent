import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { CancellationToken } from "builder-util-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadResumableUpdate, hasPartialUpdate, type UpdateTransferInput } from "./resumable-update-download.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture(data: Buffer, request: typeof fetch): Promise<UpdateTransferInput> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-update-"));
  directories.push(directory);
  return {
    cacheDirectory: path.join(directory, "cache"), oldFile: path.join(directory, "old.exe"),
    url: new URL("https://updates.example.test/new.exe"), oldMapUrl: new URL("https://updates.example.test/old.blockmap"),
    newMapUrl: new URL("https://updates.example.test/new.blockmap"), size: data.length,
    sha512: createHash("sha512").update(data).digest("base64"), request,
    cancellationToken: new CancellationToken(), onProgress: () => undefined,
  };
}

function range(request: RequestInit | undefined, data: Buffer): { start: number; end: number; body: Buffer } {
  const match = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(request?.headers).get("range") ?? "");
  if (match === null) throw new Error("Expected a byte range.");
  const start = Number(match[1]); const end = Number(match[2]);
  return { start, end, body: data.subarray(start, end + 1) };
}

function rangedResponse(data: Buffer, init?: RequestInit): Response {
  const selected = range(init, data);
  return new Response(new Uint8Array(selected.body), { status: 206,
    headers: { "content-range": `bytes ${selected.start}-${selected.end}/${data.length}` } });
}

function blockmap(chunks: readonly Buffer[]): Buffer {
  return gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0,
    sizes: chunks.map((chunk) => chunk.length), checksums: chunks.map((chunk) => createHash("sha256").update(chunk).digest("base64")) }] }));
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("resumable update downloads", () => {
  it("keeps downloaded bytes when paused and resumes after a new session", async () => {
    const data = Buffer.from("pause and resume an update download");
    let first = true;
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (!first) return Promise.resolve(rangedResponse(data, init));
      first = false;
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new Uint8Array(data.subarray(0, 6)));
        init?.signal?.addEventListener("abort", () => controller.error(new Error("cancelled")), { once: true });
      } });
      return Promise.resolve(new Response(stream, { status: 206, headers: { "content-range": `bytes 0-${data.length - 1}/${data.length}` } }));
    });
    const input = await fixture(data, request);
    const pending = downloadResumableUpdate(input);
    await vi.waitFor(async () => expect(await hasPartialUpdate(input.cacheDirectory, input.sha512)).toBe(true));
    input.cancellationToken.cancel();
    await expect(pending).rejects.toThrow(/cancelled/u);
    const resumed = await downloadResumableUpdate({ ...input, cancellationToken: new CancellationToken() });
    expect(await readFile(resumed.file)).toEqual(data);
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("range")).toBe(`bytes=6-${data.length - 1}`);
  });

  it("continues at the saved byte after an interrupted download", async () => {
    const data = Buffer.from("a resumable update with more bytes");
    let interrupted = false;
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const selected = range(init, data);
      if (interrupted) return Promise.resolve(rangedResponse(data, init));
      interrupted = true;
      let sent = false;
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new Uint8Array(selected.body.subarray(0, 7))); }
        else controller.error(new Error("network interrupted"));
      } });
      return Promise.resolve(new Response(body, { status: 206, headers: { "content-range": `bytes 0-${data.length - 1}/${data.length}` } }));
    });
    const input = await fixture(data, request);
    await expect(downloadResumableUpdate(input)).rejects.toThrow(/interrupted/u);
    expect(await hasPartialUpdate(input.cacheDirectory, input.sha512)).toBe(true);
    const result = await downloadResumableUpdate(input);
    expect(await readFile(result.file)).toEqual(data);
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("range")).toBe(`bytes=7-${data.length - 1}`);
    await result.cleanup();
    expect(await hasPartialUpdate(input.cacheDirectory, input.sha512)).toBe(false);
  });

  it("reuses unchanged blocks directly from an old version", async () => {
    const first = Buffer.alloc(16_384, 65); const oldSecond = Buffer.alloc(16_384, 66); const newSecond = Buffer.alloc(16_384, 67);
    const data = Buffer.concat([first, newSecond]);
    const request = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      const address = requestUrl(url);
      if (address.endsWith("old.blockmap")) return Promise.resolve(new Response(new Uint8Array(blockmap([first, oldSecond]))));
      if (address.endsWith("new.blockmap")) return Promise.resolve(new Response(new Uint8Array(blockmap([first, newSecond]))));
      return Promise.resolve(rangedResponse(data, init));
    });
    const input = await fixture(data, request);
    await writeFile(input.oldFile, Buffer.concat([first, oldSecond]));
    const progress = vi.fn(); input.onProgress = progress;
    const result = await downloadResumableUpdate(input);
    expect(await readFile(result.file)).toEqual(data);
    const downloads = request.mock.calls.filter(([url]) => requestUrl(url).endsWith("new.exe"));
    expect(downloads).toHaveLength(1);
    expect(new Headers(downloads[0]?.[1]?.headers).get("range")).toBe("bytes=16384-32767");
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "differential", transferred: newSecond.length, total: newSecond.length }));
  });

  it("restarts a full download safely when the server ignores a resumed range", async () => {
    const data = Buffer.from("server does not support ranges");
    let first = true;
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (first) {
        first = false;
        const selected = range(init, data);
        let sent = false;
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ pull(controller) {
          if (!sent) { sent = true; controller.enqueue(new Uint8Array(selected.body.subarray(0, 5))); }
          else controller.error(new Error("connection lost"));
        } }), { status: 206, headers: { "content-range": `bytes 0-${data.length - 1}/${data.length}` } }));
      }
      return Promise.resolve(new Response(new Uint8Array(data), { status: 200 }));
    });
    const input = await fixture(data, request);
    await expect(downloadResumableUpdate(input)).rejects.toThrow();
    const result = await downloadResumableUpdate(input);
    expect(await readFile(result.file)).toEqual(data);
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get("range")).toBe(`bytes=5-${data.length - 1}`);
    expect(new Headers(request.mock.calls[2]?.[1]?.headers).get("range")).toBe(`bytes=0-${data.length - 1}`);
  });

  it("falls back to a complete verified download when the old installer is corrupt", async () => {
    const first = Buffer.alloc(16_384, 65); const oldSecond = Buffer.alloc(16_384, 66); const newSecond = Buffer.alloc(16_384, 67);
    const data = Buffer.concat([first, newSecond]);
    const request = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      const address = requestUrl(url);
      if (address.endsWith("old.blockmap")) return Promise.resolve(new Response(new Uint8Array(blockmap([first, oldSecond]))));
      if (address.endsWith("new.blockmap")) return Promise.resolve(new Response(new Uint8Array(blockmap([first, newSecond]))));
      return Promise.resolve(rangedResponse(data, init));
    });
    const input = await fixture(data, request);
    await writeFile(input.oldFile, Buffer.concat([Buffer.alloc(first.length, 90), oldSecond]));
    const result = await downloadResumableUpdate(input);
    expect(await readFile(result.file)).toEqual(data);
    const downloads = request.mock.calls.filter(([url]) => requestUrl(url).endsWith("new.exe"));
    expect(downloads).toHaveLength(2);
    expect(new Headers(downloads[1]?.[1]?.headers).get("range")).toBe("bytes=0-32767");
  });

  it("never accepts a full installer whose checksum does not match the release metadata", async () => {
    const data = Buffer.from("expected installer contents");
    const request = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      Promise.resolve(rangedResponse(Buffer.alloc(data.length, 88), init)));
    const input = await fixture(data, request);
    await expect(downloadResumableUpdate(input)).rejects.toThrow(/校验失败/u);
    expect(await hasPartialUpdate(input.cacheDirectory, input.sha512)).toBe(false);
  });
});
