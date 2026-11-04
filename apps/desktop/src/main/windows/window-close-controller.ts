import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow, type Event } from "electron";
import path from "node:path";
import type { ApplicationSettingsStore } from "../settings/application-settings-store.js";

export class WindowCloseController {
  private tray: Tray | null = null;
  private quitting = false;
  private asking = false;

  public constructor(
    private readonly window: BrowserWindow,
    private readonly settings: ApplicationSettingsStore,
    private readonly reportError: (error: unknown) => void,
  ) {
    window.on("close", (event) => this.onClose(event));
  }

  public beginQuit(): void {
    this.quitting = true;
    this.tray?.destroy();
    this.tray = null;
  }

  private onClose(event: Event): void {
    if (this.quitting) return;
    event.preventDefault();
    if (this.asking) return;
    try {
      const behavior = this.settings.getConfiguration().general.closeBehavior;
      if (behavior === "hide") this.hide();
      else if (behavior === "quit") this.quit();
      else void this.ask();
    } catch (error) {
      this.reportError(error);
    }
  }

  private hide(): void {
    if (this.tray === null) {
      const iconPath = path.resolve(app.getAppPath(), app.isPackaged ? "renderer" : "../web/public",
        process.platform === "win32" ? "aster-logo.ico" : "aster-logo.png");
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) throw new Error("无法加载托盘图标。");
      const tray = new Tray(icon);
      tray.setToolTip("Aster");
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "打开 Aster", click: () => this.show() },
        { label: "退出 Aster", click: () => this.quit() },
      ]));
      tray.on("click", () => this.show());
      tray.on("double-click", () => this.show());
      this.tray = tray;
    }
    this.window.hide();
  }

  private show(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  private quit(): void {
    this.quitting = true;
    app.quit();
  }

  private async ask(): Promise<void> {
    this.asking = true;
    try {
      const result = await dialog.showMessageBox(this.window, {
        type: "question", title: "关闭 Aster", message: "关闭窗口时要执行什么操作？",
        detail: "隐藏到托盘后，Aster 会继续在后台运行。",
        buttons: ["隐藏到托盘", "退出软件", "取消"], defaultId: 0, cancelId: 2,
        checkboxLabel: "不再提醒，记住本次选择", checkboxChecked: false,
        noLink: true,
      });
      if (this.quitting || this.window.isDestroyed() || result.response === 2) return;
      if (result.response !== 0 && result.response !== 1) return;
      if (result.checkboxChecked) {
        const current = this.settings.getConfiguration();
        this.settings.saveConfiguration({ ...current, general: { ...current.general, closeBehavior: result.response === 0 ? "hide" : "quit" } });
      }
      if (result.response === 0) this.hide();
      else this.quit();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.asking = false;
    }
  }
}
