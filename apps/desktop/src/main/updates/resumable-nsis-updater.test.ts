import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CancellationToken } from "builder-util-runtime";
import type { AppAdapter } from "electron-updater/out/AppAdapter.js";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumableNsisUpdater } from "./resumable-nsis-updater.js";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: network.fetch } }));

const directories: string[] = [];
afterEach(async () => {
  network.fetch.mockReset();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class TestUpdater extends ResumableNsisUpdater {
  public perform(options: DownloadUpdateOptions) { return this.doDownloadUpdate(options); }
}

async function fixture(publisher?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-nsis-update-"));
  directories.push(directory);
  const config = path.join(directory, "app-update.yml");
  await writeFile(config, `updaterCacheDirName: aster-updater\n${publisher === undefined ? "" : `publisherName: ${publisher}\n`}`);
  const app: AppAdapter = {
    version: "0.1.0", name: "Aster", isPackaged: true, appUpdateConfigPath: config,
    userDataPath: path.join(directory, "user"), baseCachePath: path.join(directory, "cache"),
    whenReady: () => Promise.resolve(), relaunch: () => undefined, quit: () => undefined, onQuit: () => undefined,
  };
  const data = Buffer.from("verified test installer");
  const sha512 = createHash("sha512").update(data).digest("base64");
  const url = new URL("https://github.com/GuoWWWX/aster-agent/releases/download/v0.2.0/Aster-0.2.0-x64-setup.exe");
  const info = { version: "0.2.0", files: [{ url: path.basename(url.pathname), sha512, size: data.length }],
    path: path.basename(url.pathname), sha512, releaseDate: "2026-01-01" };
  const options = { updateInfoAndProvider: { info, provider: {
    resolveFiles: () => [{ url, info: info.files[0] }],
    getBlockMapFiles: () => [new URL(`${url}.old.blockmap`), new URL(`${url}.blockmap`)],
  } }, requestHeaders: {}, cancellationToken: new CancellationToken() } as unknown as DownloadUpdateOptions;
  network.fetch.mockResolvedValue(new Response(new Uint8Array(data), { status: 206,
    headers: { "content-range": `bytes 0-${data.length - 1}/${data.length}` } }));
  const progress = vi.fn();
  const updater = new TestUpdater(progress, app);
  return { updater, options, data, progress, url };
}

describe("ResumableNsisUpdater", () => {
  it("hands a verified installer to the upstream NSIS update lifecycle", async () => {
    const { updater, options, data, progress } = await fixture();
    const downloaded = vi.fn(); updater.on("update-downloaded", downloaded);
    const result = await updater.perform(options);
    expect(await readFile(result.updateFile)).toEqual(data);
    expect(downloaded).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ transferred: data.length, total: data.length }));
  });

  it("requires the configured publisher signature when one is present", async () => {
    const { updater, options } = await fixture("Aster Publisher");
    updater.verifyUpdateCodeSignature = vi.fn().mockResolvedValue("invalid signature");
    await expect(updater.perform(options)).rejects.toThrow(/签名验证失败/u);
    expect(updater.verifyUpdateCodeSignature).toHaveBeenCalledWith(["Aster Publisher"], expect.any(String));
  });

  it("refuses an installer URL outside the official repository", async () => {
    const { updater, options, url } = await fixture();
    url.hostname = "example.com";
    await expect(updater.perform(options)).rejects.toThrow(/官方发布页面/u);
    expect(network.fetch).not.toHaveBeenCalled();
  });
});
