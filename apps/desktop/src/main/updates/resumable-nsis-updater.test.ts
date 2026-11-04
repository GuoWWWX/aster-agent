import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CancellationToken, HttpError } from "builder-util-runtime";
import type { AppAdapter } from "electron-updater/out/AppAdapter.js";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
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

async function fixture(publisher?: string, version = "0.1.0") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-nsis-update-"));
  directories.push(directory);
  const config = path.join(directory, "app-update.yml");
  await writeFile(config, `updaterCacheDirName: aster-updater\n${publisher === undefined ? "" : `publisherName: ${publisher}\n`}`);
  const app: AppAdapter = {
    version, name: "Aster", isPackaged: true, appUpdateConfigPath: config,
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
  it("receives prereleases only when the installed version is a prerelease", async () => {
    const stable = await fixture();
    const beta = await fixture(undefined, "0.1.0-beta.1");
    expect(stable.updater.allowPrerelease).toBe(false);
    expect(beta.updater.allowPrerelease).toBe(true);
    expect(stable.updater.allowDowngrade).toBe(false);
    expect(beta.updater.allowDowngrade).toBe(false);
  });

  it("selects the stable release for stable clients and beta for beta clients", async () => {
    const stable = await fixture(undefined, "0.0.9");
    const beta = await fixture(undefined, "0.1.0-beta.1");
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>beta</title><link href="https://github.com/GuoWWWX/aster-agent/releases/tag/v0.1.0-beta.2"/><content>beta</content></entry>
      <entry><title>stable</title><link href="https://github.com/GuoWWWX/aster-agent/releases/tag/v0.0.9"/><content>stable</content></entry>
    </feed>`;
    const request = vi.fn((options: { path?: string }) => {
      const requested = options.path ?? "";
      if (requested.endsWith(".atom")) return Promise.resolve(feed);
      if (requested.endsWith("/latest")) return Promise.resolve(JSON.stringify({ tag_name: "v0.0.9" }));
      if (requested.endsWith("/beta.yml")) return Promise.resolve("version: 0.1.0-beta.2\npath: setup.exe\nsha512: hash\n");
      if (requested.endsWith("/latest.yml")) return Promise.resolve("version: 0.0.9\npath: setup.exe\nsha512: hash\n");
      return Promise.reject(new Error(`Unexpected request: ${requested}`));
    });
    const runtime = { platform: "win32", isUseMultipleRangeRequest: false, executor: { request } } as unknown as ProviderRuntimeOptions;
    const github = { provider: "github" as const, owner: "GuoWWWX", repo: "aster-agent" };
    const stableProvider = new GitHubProvider({ ...github, channel: "latest" }, stable.updater, runtime);
    const betaProvider = new GitHubProvider({ ...github, channel: "beta" }, beta.updater, runtime);
    expect((await stableProvider.getLatestVersion()).version).toBe("0.0.9");
    expect((await betaProvider.getLatestVersion()).version).toBe("0.1.0-beta.2");
    expect(request.mock.calls.some(([options]) => options.path?.includes("v0.1.0-beta.2/beta.yml"))).toBe(true);
  });

  it("lets beta clients advance to a newer stable release", async () => {
    const beta = await fixture(undefined, "0.1.0-beta.2");
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>stable</title>
      <link href="https://github.com/GuoWWWX/aster-agent/releases/tag/v0.1.0"/><content>stable</content></entry></feed>`;
    const request = vi.fn((options: { path?: string }) => {
      const requested = options.path ?? "";
      if (requested.endsWith(".atom")) return Promise.resolve(feed);
      if (requested.endsWith("/beta.yml")) return Promise.reject(new HttpError(404));
      if (requested.endsWith("/latest.yml")) return Promise.resolve("version: 0.1.0\npath: setup.exe\nsha512: hash\n");
      return Promise.reject(new Error(`Unexpected request: ${requested}`));
    });
    const runtime = { platform: "win32", isUseMultipleRangeRequest: false, executor: { request } } as unknown as ProviderRuntimeOptions;
    const provider = new GitHubProvider({ provider: "github", owner: "GuoWWWX", repo: "aster-agent", channel: "beta" }, beta.updater, runtime);
    expect((await provider.getLatestVersion()).version).toBe("0.1.0");
  });

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
