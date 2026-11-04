import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { net } from "electron";
import { CancellationError } from "builder-util-runtime";
import { NsisUpdater } from "electron-updater";
import type { AppAdapter } from "electron-updater/out/AppAdapter.js";
import type { DownloadExecutorResult, DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import { findFile } from "electron-updater/out/providers/Provider.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { downloadResumableUpdate, type UpdateTransferProgress } from "./resumable-update-download.js";

const publisherSchema = z.object({ publisherName: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional() }).passthrough();
const RELEASE_PATH = "/GuoWWWX/aster-agent/releases/download/";

function requireOfficialReleaseUrl(url: URL): void {
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || !url.pathname.startsWith(RELEASE_PATH) || url.username || url.password) {
    throw new Error("更新文件地址不属于 Aster 官方发布页面。");
  }
}

/** Uses electron-updater's NSIS lifecycle and signature verification with a resumable transfer. */
export class ResumableNsisUpdater extends NsisUpdater {
  public constructor(private readonly onTransfer: (progress: UpdateTransferProgress) => void, app?: AppAdapter) {
    super(null, app);
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.disableWebInstaller = true;
  }

  protected override async doDownloadUpdate(options: DownloadUpdateOptions): Promise<DownloadExecutorResult> {
    const provider = options.updateInfoAndProvider.provider;
    const info = options.updateInfoAndProvider.info;
    const file = findFile(provider.resolveFiles(info), "exe");
    if (file === undefined || file === null || file.packageInfo !== undefined || typeof file.info.sha512 !== "string" ||
        typeof file.info.size !== "number" || !Number.isSafeInteger(file.info.size) || file.info.size <= 0) {
      throw new Error("更新发布信息缺少有效的安装包校验数据。");
    }
    const size = file.info.size;
    const sha512 = file.info.sha512;
    requireOfficialReleaseUrl(file.url);
    const [oldMapUrl, newMapUrl] = await provider.getBlockMapFiles(file.url, this.app.version, info.version, this.previousBlockmapBaseUrlOverride);
    if (oldMapUrl === undefined || newMapUrl === undefined) throw new Error("更新差量地址无效。");
    requireOfficialReleaseUrl(oldMapUrl);
    requireOfficialReleaseUrl(newMapUrl);

    let cleanup: (() => Promise<void>) | undefined;
    const result = await this.executeDownload({
      fileExtension: "exe", fileInfo: file, downloadUpdateOptions: options,
      task: async (destination) => {
        if (this.downloadedUpdateHelper === null) throw new Error("更新缓存不可用。");
        const transfer = await downloadResumableUpdate({
          cacheDirectory: path.join(this.app.userDataPath, "update-downloads"),
          oldFile: path.join(this.downloadedUpdateHelper.cacheDir, "installer.exe"),
          oldMapUrl, newMapUrl, url: file.url, sha512, size,
          cancellationToken: options.cancellationToken,
          request: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
          onProgress: (progress) => {
            this.onTransfer(progress);
            this.emit("download-progress", { ...progress, percent: progress.transferred * 100 / progress.total, delta: 0 });
          },
        });
        cleanup = transfer.cleanup;
        await copyFile(transfer.file, destination);
        if (options.cancellationToken.cancelled) throw new CancellationError();
        const config = publisherSchema.parse(parseYaml(await readFile(this.app.appUpdateConfigPath, "utf8")) as unknown);
        if (config.publisherName !== undefined) {
          const names = Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName];
          if (await this.verifyUpdateCodeSignature(names, destination) !== null) throw new Error("更新安装包的签名验证失败。");
        }
      },
    });
    // The verified installer is already in electron-updater's cache at this point.
    // A cleanup failure must not turn a successful download into a failed update.
    await cleanup?.().catch(() => undefined);
    return result;
  }
}
