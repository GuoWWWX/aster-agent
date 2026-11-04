import { CancellationToken } from "builder-util-runtime";
import { appUpdateStateSchema, type AppUpdateState } from "@agent/protocol";
import type { UpdateCheckResult } from "electron-updater";
import { hasPartialUpdate, type UpdateTransferProgress } from "./resumable-update-download.js";

type UpdateEngine = {
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(token: CancellationToken): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

export class AppUpdateController {
  private state: AppUpdateState;
  private readonly listeners = new Set<(state: AppUpdateState) => void>();
  private activeDownload: { token: CancellationToken; done: Promise<void> } | null = null;
  private activeCheck: Promise<AppUpdateState> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly engine: UpdateEngine,
    private readonly cacheDirectory: string,
    version: string,
    private readonly supported: boolean,
  ) {
    this.state = { status: supported ? "idle" : "unavailable", currentVersion: version,
      availableVersion: null, progress: null, message: supported ? null : "自动更新仅在已安装的 Windows 版本中可用。" };
  }

  public getState(): AppUpdateState { return appUpdateStateSchema.parse(this.state); }

  public subscribe(listener: (state: AppUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<AppUpdateState>): void {
    this.state = appUpdateStateSchema.parse({ ...this.state, ...patch });
    for (const listener of this.listeners) listener(this.getState());
  }

  public start(): void {
    if (!this.supported || this.startupTimer !== null || this.interval !== null) return;
    this.startupTimer = setTimeout(() => { this.startupTimer = null; void this.check(); }, 5_000);
    this.startupTimer.unref();
    this.interval = setInterval(() => {
      if (this.activeDownload === null) void this.check();
    }, 4 * 60 * 60 * 1000);
    this.interval.unref();
  }

  public check(): Promise<AppUpdateState> {
    if (!this.supported) return Promise.resolve(this.getState());
    if (this.activeCheck !== null) return this.activeCheck;
    this.activeCheck = this.checkOnce().finally(() => { this.activeCheck = null; });
    return this.activeCheck;
  }

  private async checkOnce(): Promise<AppUpdateState> {
    if (this.activeDownload !== null) await this.pause();
    const readyVersion = this.state.status === "downloaded" ? this.state.availableVersion : null;
    this.update({ status: "checking", message: null });
    try {
      const result = await this.engine.checkForUpdates();
      if (result === null || !result.isUpdateAvailable) {
        this.update({ status: "up-to-date", availableVersion: null, progress: null, message: null });
      } else {
        const file = result.updateInfo.files.find((item) => item.url.toLowerCase().endsWith(".exe"));
        const partial = typeof file?.sha512 === "string" && await hasPartialUpdate(this.cacheDirectory, file.sha512);
        this.update({ status: readyVersion === result.updateInfo.version ? "downloaded" : partial ? "paused" : "available",
          availableVersion: result.updateInfo.version, progress: null, message: null });
      }
    } catch {
      this.update({ status: "error", message: "检查更新失败，请检查网络后重试。" });
    }
    return this.getState();
  }

  public download(): AppUpdateState {
    if (!this.supported || this.activeDownload !== null || this.activeCheck !== null || this.state.availableVersion === null ||
        !["available", "paused", "error"].includes(this.state.status)) return this.getState();
    const token = new CancellationToken();
    this.update({ status: "downloading", message: null });
    const done = Promise.resolve().then(() => this.engine.downloadUpdate(token)).then(() => {
      this.update({ status: "downloaded", message: null });
    }).catch(() => {
      this.update(token.cancelled
        ? { status: "paused", message: null }
        : { status: "error", message: "下载或校验更新失败，可继续下载或重新检查。" });
    }).finally(() => {
      if (this.activeDownload?.token === token) this.activeDownload = null;
      token.dispose();
    });
    this.activeDownload = { token, done };
    return this.getState();
  }

  public reportProgress(progress: UpdateTransferProgress): void {
    if (this.state.status === "downloading") this.update({ progress });
  }

  public async pause(): Promise<AppUpdateState> {
    const active = this.activeDownload;
    if (active !== null) { active.token.cancel(); await active.done; }
    return this.getState();
  }

  public install(): AppUpdateState {
    if (this.state.status === "downloaded") this.engine.quitAndInstall(true, true);
    return this.getState();
  }

  public async dispose(): Promise<void> {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    if (this.interval !== null) clearInterval(this.interval);
    this.startupTimer = null;
    this.interval = null;
    await this.pause();
    this.listeners.clear();
  }
}
