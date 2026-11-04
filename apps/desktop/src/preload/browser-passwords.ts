import { ipcRenderer } from "electron";
import { BROWSER_PASSWORD_CHANNELS, browserPasswordConfigurationSchema, type BrowserCredential } from "@agent/protocol/browser";
import { fillBrowserLogin, readBrowserLogin } from "./browser-password-form.js";

// No browser-page bridge: all credential handling stays in the isolated preload.
if (window === window.top) {
  let enabled = false;
  let credential: BrowserCredential | null = null;
  const fill = (): void => {
    if (enabled && credential?.origin === location.origin) fillBrowserLogin(document, credential);
  };
  ipcRenderer.on(BROWSER_PASSWORD_CHANNELS.configure, (_event, input: unknown) => {
    const parsed = browserPasswordConfigurationSchema.safeParse(input);
    if (!parsed.success) return;
    enabled = parsed.data.enabled && location.protocol === "https:";
    credential = enabled ? parsed.data.credential : null;
    fill();
  });
  window.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(fill).observe(document, { childList: true, subtree: true });
  });
  document.addEventListener("submit", (event) => {
    if (!enabled || !event.isTrusted || !(event.target instanceof HTMLFormElement)) return;
    const login = readBrowserLogin(event.target, location.origin);
    if (login !== null) ipcRenderer.send(BROWSER_PASSWORD_CHANNELS.submit, login);
  }, true);
}
