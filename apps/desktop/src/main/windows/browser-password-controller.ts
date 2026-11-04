import { dialog, type BrowserWindow, type IpcMainEvent, type WebContents } from "electron";
import { BROWSER_PASSWORD_CHANNELS, browserCredentialSchema } from "@agent/protocol";
import type { BrowserPasswordStore } from "../settings/browser-password-store.js";

export function installBrowserPasswords(
  contents: WebContents,
  window: BrowserWindow,
  store: BrowserPasswordStore,
  isEnabled: () => boolean,
  onError: (message: string) => void,
): { refresh(): void; dispose(): void } {
  let disposed = false;
  let prompting = false;
  const refresh = (): void => {
    if (disposed || contents.isDestroyed()) return;
    try {
      const url = new URL(contents.getURL() || "about:blank");
      const enabled = isEnabled() && url.protocol === "https:" && store.isAvailable();
      contents.send(BROWSER_PASSWORD_CHANNELS.configure, {
        enabled, credential: enabled ? store.get(url.origin) : null,
      });
    } catch {
      contents.send(BROWSER_PASSWORD_CHANNELS.configure, { enabled: false, credential: null });
      onError("无法读取已保存的浏览器密码。");
    }
  };
  const handleSubmit = async (event: IpcMainEvent, channel: string, ...args: unknown[]): Promise<void> => {
    if (disposed || prompting || !isEnabled() || channel !== BROWSER_PASSWORD_CHANNELS.submit
      || event.senderFrame !== contents.mainFrame || args.length !== 1) return;
    const parsed = browserCredentialSchema.safeParse(args[0]);
    if (!parsed.success || event.senderFrame?.url === undefined) return;
    const credential = parsed.data;
    prompting = true;
    try {
      if (new URL(event.senderFrame.url).origin !== credential.origin) return;
      if (!store.isAvailable()) {
        onError("系统密码加密不可用，未保存密码。");
        return;
      }
      const saved = store.get(credential.origin);
      if (saved?.username === credential.username && saved.password === credential.password) return;
      const result = await dialog.showMessageBox(window, {
        type: "question", title: "保存密码", message: `保存 ${credential.origin} 的登录密码？`,
        detail: "密码使用系统加密保存，下次访问同一网站时自动填充。",
        buttons: ["保存", "暂不"], defaultId: 0, cancelId: 1, noLink: true,
      });
      if (!disposed && isEnabled() && result.response === 0) store.save(credential);
    } catch {
      onError("浏览器密码保存失败，未更新已保存的密码。");
    } finally { prompting = false; }
  };
  const onMessage = (event: IpcMainEvent, channel: string, ...args: unknown[]): void => {
    void handleSubmit(event, channel, ...args);
  };
  contents.on("dom-ready", refresh);
  contents.on("ipc-message", onMessage);
  return {
    refresh,
    dispose: () => {
      disposed = true;
      contents.removeListener("dom-ready", refresh);
      contents.removeListener("ipc-message", onMessage);
    },
  };
}
