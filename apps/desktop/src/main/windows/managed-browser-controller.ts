import { randomUUID } from "node:crypto";

import {
  BrowserWindow,
  dialog,
  Menu,
  WebContentsView,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
} from "electron";

import {
  managedBrowserEventSchema,
  managedBrowserSessionSchema,
  managedBrowserSnapshotSchema,
  type ManagedBrowserBoundsInput,
  type ManagedBrowserCommandInput,
  type ManagedBrowserEvent,
  type ManagedBrowserNavigateInput,
  type ManagedBrowserOpenInput,
  type ManagedBrowserReferenceInput,
  type ManagedBrowserSession,
  type ManagedBrowserSnapshot,
} from "@agent/protocol";

import { BrowserConfigurationStore } from "../settings/browser-configuration-store.js";

import { z } from "zod";

const DEFAULT_BROWSER_URL = "https://www.google.com/";
const DEFAULT_SEARCH_URL = "https://www.google.com/search";
const MANAGED_BROWSER_PARTITION = "persist:aster-managed-browser";
const TITLEBAR_HEIGHT = 36;
const ZOOM_PERCENT_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const;

type BrowserPageState = Omit<ManagedBrowserSession, "sessionId">;
type BrowserEventListener = (event: ManagedBrowserEvent) => void;

const MAX_BROWSER_OBSERVATION_ELEMENTS = 200;
const MAX_BROWSER_OBSERVATION_TEXT_CHARS = 24_000;

const browserAutomationElementSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(800),
  role: z.string().max(80),
  tagName: z.string().max(80),
  text: z.string().max(1_200),
}).strict();

const managedBrowserObservationSchema = z.object({
  elements: z.array(browserAutomationElementSchema).max(MAX_BROWSER_OBSERVATION_ELEMENTS),
  text: z.string().max(MAX_BROWSER_OBSERVATION_TEXT_CHARS),
  textTruncated: z.boolean(),
  title: z.string().max(1_024),
  url: z.string().max(8_192),
}).strict();

export type ManagedBrowserAutomationElement = z.infer<typeof browserAutomationElementSchema>;
export type ManagedBrowserObservation = z.infer<typeof managedBrowserObservationSchema>;

export type ManagedBrowserInteraction =
  | { kind: "click"; elementId: string }
  | { kind: "fill"; elementId: string; text: string }
  | { kind: "select"; elementId: string; value: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; deltaX: number; deltaY: number };

export type ManagedBrowserAutomationPort = {
  close(input: ManagedBrowserReferenceInput): void;
  interact(input: ManagedBrowserInteraction & ManagedBrowserReferenceInput): Promise<void>;
  navigate(input: ManagedBrowserNavigateInput): Promise<void>;
  observe(input: ManagedBrowserReferenceInput): Promise<ManagedBrowserObservation>;
  open(input: ManagedBrowserOpenInput): Promise<ManagedBrowserSession>;
};

type ManagedBrowserPage = {
  back(): void;
  capture(): Promise<ManagedBrowserSnapshot>;
  clearBrowsingData(): Promise<void>;
  close(): void;
  forward(): void;
  getState(): BrowserPageState;
  load(url: string): Promise<void>;
  onError(listener: (message: string) => void): () => void;
  onStateChanged(listener: () => void): () => void;
  openDevTools(): void;
  interact?(input: ManagedBrowserInteraction): Promise<void>;
  observe?(): Promise<ManagedBrowserObservation>;
  print(): Promise<void>;
  reload(): void;
  setBounds(bounds: Rectangle): void;
  setVisible(visible: boolean): void;
  setZoomPercent(percent: number): void;
  stop(): void;
  zoomIn(): void;
  zoomOut(): void;
};

type BrowserPageFactory = (window: BrowserWindow) => ManagedBrowserPage;

type ActiveBrowserSession = {
  disposeError: () => void;
  disposeState: () => void;
  page: ManagedBrowserPage;
};

export class ManagedBrowserController {
  private readonly listeners = new Set<BrowserEventListener>();
  private readonly sessions = new Map<string, ActiveBrowserSession>();

  public constructor(
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly browserConfiguration: Pick<BrowserConfigurationStore, "getConfiguration">,
    private readonly createPage: BrowserPageFactory = createElectronBrowserPage,
  ) {}

  public async open(input: ManagedBrowserOpenInput): Promise<ManagedBrowserSession> {
    const window = this.requireWindow();
    const page = this.createPage(window);
    const sessionId = randomUUID();
    const disposeState = page.onStateChanged(() => this.emitState(sessionId));
    const disposeError = page.onError((message) => {
      this.emit({ message, sessionId, type: "error" });
    });
    this.sessions.set(sessionId, { disposeError, disposeState, page });
    try {
      await page.load(resolveManagedBrowserAddress(input.url ?? DEFAULT_BROWSER_URL));
      page.setZoomPercent(this.browserConfiguration.getConfiguration().defaultZoomPercent);
      return this.sessionState(sessionId);
    } catch (error) {
      this.close({ sessionId });
      throw error;
    }
  }

  public async navigate(input: ManagedBrowserNavigateInput): Promise<void> {
    await this.requireSession(input.sessionId).page.load(resolveManagedBrowserAddress(input.url));
  }

  public async command(input: ManagedBrowserCommandInput): Promise<void> {
    const page = this.requireSession(input.sessionId).page;
    switch (input.command) {
      case "back":
        page.back();
        return;
      case "clearBrowsingData":
        await page.clearBrowsingData();
        return;
      case "forward":
        page.forward();
        return;
      case "openDevTools":
        page.openDevTools();
        return;
      case "print":
        await page.print();
        return;
      case "reload":
        page.reload();
        return;
      case "resetZoom":
        page.setZoomPercent(100);
        return;
      case "showMenu":
        this.showMenu(input.sessionId);
        return;
      case "stop":
        page.stop();
        return;
      case "zoomIn":
        page.zoomIn();
        return;
      case "zoomOut":
        page.zoomOut();
    }
  }

  public async capture(input: ManagedBrowserReferenceInput): Promise<ManagedBrowserSnapshot> {
    return managedBrowserSnapshotSchema.parse(
      await this.requireSession(input.sessionId).page.capture(),
    );
  }

  public async observe(input: ManagedBrowserReferenceInput): Promise<ManagedBrowserObservation> {
    const page = this.requireSession(input.sessionId).page;
    if (page.observe === undefined) throw new Error("The managed browser automation surface is unavailable.");
    return managedBrowserObservationSchema.parse(await page.observe());
  }

  public async interact(input: ManagedBrowserInteraction & ManagedBrowserReferenceInput): Promise<void> {
    const page = this.requireSession(input.sessionId).page;
    if (page.interact === undefined) throw new Error("The managed browser automation surface is unavailable.");
    await page.interact(input);
  }

  public setBounds(input: ManagedBrowserBoundsInput): void {
    const window = this.requireWindow();
    const page = this.requireSession(input.sessionId).page;
    if (!input.visible || input.width === 0 || input.height === 0) {
      page.setVisible(false);
      return;
    }
    const [contentWidth = 1, contentHeight = 1] = window.getContentSize();
    const x = Math.min(input.x, Math.max(0, contentWidth - 1));
    const y = Math.min(Math.max(TITLEBAR_HEIGHT, input.y), Math.max(TITLEBAR_HEIGHT, contentHeight - 1));
    page.setBounds({
      height: Math.max(1, Math.min(input.height, contentHeight - y)),
      width: Math.max(1, Math.min(input.width, contentWidth - x)),
      x,
      y,
    });
    page.setVisible(true);
  }

  public close(input: ManagedBrowserReferenceInput): void {
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) return;
    this.sessions.delete(input.sessionId);
    session.disposeError();
    session.disposeState();
    session.page.close();
  }

  public onEvent(listener: BrowserEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.listeners.clear();
    for (const sessionId of [...this.sessions.keys()]) this.close({ sessionId });
  }

  private emitState(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.emit({ session: this.sessionState(sessionId), type: "state" });
  }

  private showMenu(sessionId: string): void {
    const window = this.requireWindow();
    const page = this.requireSession(sessionId).page;
    const { zoomPercent } = page.getState();
    const template: MenuItemConstructorOptions[] = [
      {
        label: `缩放 ${zoomPercent}%`,
        submenu: [
          {
            click: () => page.zoomOut(),
            enabled: zoomPercent > 25,
            label: "缩小",
          },
          {
            click: () => page.setZoomPercent(100),
            enabled: zoomPercent !== 100,
            label: "恢复为 100%",
          },
          {
            click: () => page.zoomIn(),
            enabled: zoomPercent < 500,
            label: "放大",
          },
        ],
      },
      { type: "separator" },
      {
        click: () => this.runMenuAction(sessionId, () => page.print(), "打印失败。"),
        label: "打印",
      },
      {
        click: () => page.openDevTools(),
        label: "开发者工具",
      },
      {
        click: () => this.runMenuAction(
          sessionId,
          () => this.confirmAndClearBrowsingData(window, page),
          "清除浏览数据失败。",
        ),
        label: "清除浏览数据",
      },
      { type: "separator" },
      {
        click: () => this.emit({ sessionId, type: "openSettings" }),
        label: "浏览器设置",
      },
    ];
    Menu.buildFromTemplate(template).popup({ window });
  }

  private runMenuAction(
    sessionId: string,
    action: () => Promise<void>,
    fallbackMessage: string,
  ): void {
    void action().catch((error: unknown) => {
      this.emit({
        message: error instanceof Error ? error.message : fallbackMessage,
        sessionId,
        type: "error",
      });
    });
  }

  private async confirmAndClearBrowsingData(
    window: BrowserWindow,
    page: ManagedBrowserPage,
  ): Promise<void> {
    const result = await dialog.showMessageBox(window, {
      buttons: ["取消", "清除"],
      cancelId: 0,
      defaultId: 0,
      message: "清除内置浏览器的 Cookie、缓存和站点数据？",
      noLink: true,
      title: "清除浏览数据",
      type: "warning",
    });
    if (result.response === 1) await page.clearBrowsingData();
  }

  private emit(event: ManagedBrowserEvent): void {
    const parsed = managedBrowserEventSchema.parse(event);
    for (const listener of this.listeners) listener(parsed);
  }

  private sessionState(sessionId: string): ManagedBrowserSession {
    const state = this.requireSession(sessionId).page.getState();
    return managedBrowserSessionSchema.parse({ ...state, sessionId });
  }

  private requireSession(sessionId: string): ActiveBrowserSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error("浏览器标签不存在或已经关闭。");
    return session;
  }

  private requireWindow(): BrowserWindow {
    const window = this.getMainWindow();
    if (window === undefined || window.isDestroyed()) throw new Error("主窗口当前不可用。");
    return window;
  }
}

export function normalizeManagedBrowserUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("请输入有效的网址。");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("内置浏览器只允许不含凭据的 HTTP/HTTPS 地址。");
  }
  return url.href;
}

export function resolveManagedBrowserAddress(value: string): string {
  const trimmed = value.trim();
  if (isLikelyBrowserHost(trimmed)) {
    return normalizeManagedBrowserUrl(`https://${trimmed}`);
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed)) {
    return normalizeManagedBrowserUrl(trimmed);
  }
  const searchUrl = new URL(DEFAULT_SEARCH_URL);
  searchUrl.searchParams.set("q", trimmed);
  return searchUrl.href;
}

function isLikelyBrowserHost(value: string): boolean {
  if (value.length === 0 || /\s/u.test(value)) return false;
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase();
    return hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.includes(".")
      || hostname.includes(":");
  } catch {
    return false;
  }
}

function createElectronBrowserPage(window: BrowserWindow): ManagedBrowserPage {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: MANAGED_BROWSER_PARTITION,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.contentView.addChildView(view);
  view.setVisible(false);
  const webContents = view.webContents;
  const stateListeners = new Set<() => void>();
  const errorListeners = new Set<(message: string) => void>();
  let zoomPercent = 100;
  let observationSequence = 0;
  const applyZoomPercent = (percent: number): void => {
    zoomPercent = Math.min(500, Math.max(25, Math.round(percent)));
    webContents.setZoomFactor(zoomPercent / 100);
  };
  const emitState = (): void => {
    for (const listener of stateListeners) listener();
  };
  const emitError = (message: string): void => {
    for (const listener of errorListeners) listener(message);
  };
  webContents.on("did-start-loading", emitState);
  webContents.on("did-stop-loading", emitState);
  webContents.on("did-navigate", () => {
    applyZoomPercent(zoomPercent);
    emitState();
  });
  webContents.on("did-navigate-in-page", emitState);
  webContents.on("page-title-updated", emitState);
  webContents.on("zoom-changed", (event, direction) => {
    event.preventDefault();
    applyZoomPercent(adjacentZoomPercent(zoomPercent, direction));
    emitState();
  });
  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    emitError(`${errorDescription}（${validatedUrl}）`);
  });
  webContents.on("will-navigate", (event) => {
    try {
      normalizeManagedBrowserUrl(event.url);
    } catch {
      event.preventDefault();
      emitError("已阻止非 HTTP/HTTPS 页面导航。");
    }
  });
  webContents.setWindowOpenHandler(({ url }) => {
    try {
      void webContents.loadURL(normalizeManagedBrowserUrl(url)).catch((error: unknown) => {
        emitError(error instanceof Error ? error.message : "网页打开失败。");
      });
    } catch (error) {
      emitError(error instanceof Error ? error.message : "网页打开失败。");
    }
    return { action: "deny" };
  });
  installManagedBrowserSessionPolicy(webContents.session);

  return {
    back: () => {
      if (webContents.navigationHistory.canGoBack()) webContents.navigationHistory.goBack();
    },
    capture: async () => {
      const image = await webContents.capturePage();
      const { height, width } = image.getSize();
      return managedBrowserSnapshotSchema.parse({
        data: image.toJPEG(88).toString("base64"),
        height,
        mimeType: "image/jpeg",
        width,
      });
    },
    clearBrowsingData: async () => {
      await webContents.session.clearData();
      webContents.reload();
    },
    close: () => {
      stateListeners.clear();
      errorListeners.clear();
      window.contentView.removeChildView(view);
      if (!webContents.isDestroyed()) webContents.close();
    },
    forward: () => {
      if (webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
    },
    getState: () => ({
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: webContents.isLoading(),
      title: webContents.getTitle(),
      url: webContents.getURL(),
      zoomPercent,
    }),
    load: async (url) => {
      await webContents.loadURL(url);
    },
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onStateChanged: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    openDevTools: () => webContents.openDevTools({ mode: "detach" }),
    interact: async (input) => {
      switch (input.kind) {
        case "scroll":
          await webContents.executeJavaScript(
            `window.scrollBy(${JSON.stringify(input.deltaX)}, ${JSON.stringify(input.deltaY)});`,
            true,
          );
          return;
        case "key":
          await webContents.executeJavaScript(browserKeyScript(input.key), true);
          return;
        case "click":
          await webContents.executeJavaScript(browserElementActionScript(input.elementId, "click"), true);
          return;
        case "fill":
          await webContents.executeJavaScript(
            browserElementActionScript(input.elementId, "fill", input.text),
            true,
          );
          return;
        case "select":
          await webContents.executeJavaScript(
            browserElementActionScript(input.elementId, "select", input.value),
            true,
          );
          return;
      }
    },
    observe: async () => managedBrowserObservationSchema.parse(
      await webContents.executeJavaScript(browserObservationScript(++observationSequence), true),
    ),
    print: () => new Promise<void>((resolve, reject) => {
      webContents.print({ printBackground: true }, (success, failureReason) => {
        if (success) {
          resolve();
          return;
        }
        reject(new Error(failureReason || "打印未完成。"));
      });
    }),
    reload: () => webContents.reload(),
    setBounds: (bounds) => view.setBounds(bounds),
    setVisible: (visible) => view.setVisible(visible),
    setZoomPercent: (percent) => {
      applyZoomPercent(percent);
      emitState();
    },
    stop: () => webContents.stop(),
    zoomIn: () => {
      applyZoomPercent(adjacentZoomPercent(zoomPercent, "in"));
      emitState();
    },
    zoomOut: () => {
      applyZoomPercent(adjacentZoomPercent(zoomPercent, "out"));
      emitState();
    },
  };
}

function adjacentZoomPercent(current: number, direction: "in" | "out"): number {
  if (direction === "in") {
    return ZOOM_PERCENT_STEPS.find((candidate) => candidate > current) ?? 500;
  }
  return [...ZOOM_PERCENT_STEPS].reverse().find((candidate) => candidate < current) ?? 25;
}

function browserObservationScript(sequence: number): string {
  return `(() => {
    const maxElements = ${MAX_BROWSER_OBSERVATION_ELEMENTS};
    const maxText = ${MAX_BROWSER_OBSERVATION_TEXT_CHARS};
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const textFor = (element) => String(
      element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || ""
    ).replace(/\\s+/g, " ").trim().slice(0, 1200);
    const candidates = Array.from(document.querySelectorAll(
      "a, button, input, textarea, select, summary, [contenteditable='true'], [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='tab'], [role='menuitem']"
    )).filter(isVisible).slice(0, maxElements);
    const elements = candidates.map((element, index) => {
      const id = "agent-${sequence}-" + index;
      element.setAttribute("data-agent-browser-ref", id);
      return {
        id,
        name: String(element.getAttribute("name") || "").slice(0, 800),
        role: String(element.getAttribute("role") || element.tagName.toLowerCase()).slice(0, 80),
        tagName: element.tagName.toLowerCase().slice(0, 80),
        text: textFor(element),
      };
    });
    const bodyText = String(document.body?.innerText || "").replace(/\\s+\\n/g, "\\n").trim();
    return {
      elements,
      text: bodyText.slice(0, maxText),
      textTruncated: bodyText.length > maxText,
      title: String(document.title || "").slice(0, 1024),
      url: String(location.href || "").slice(0, 8192),
    };
  })()`;
}

function browserElementActionScript(
  elementId: string,
  action: "click" | "fill" | "select",
  value?: string,
): string {
  return `(() => {
    const id = ${JSON.stringify(elementId)};
    const element = Array.from(document.querySelectorAll("[data-agent-browser-ref]")).find(
      (candidate) => candidate.getAttribute("data-agent-browser-ref") === id,
    );
    if (!(element instanceof HTMLElement)) throw new Error("Browser element reference is stale. Observe the page again.");
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus({ preventScroll: true });
    const action = ${JSON.stringify(action)};
    const value = ${JSON.stringify(value ?? "")};
    if (action === "click") {
      if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
        throw new Error("The browser element is disabled.");
      }
      element.click();
      return;
    }
    if (action === "select") {
      if (!(element instanceof HTMLSelectElement)) throw new Error("The selected browser element is not a select control.");
      const option = Array.from(element.options).find((candidate) => candidate.value === value);
      if (option === undefined) throw new Error("The requested select option is unavailable.");
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      throw new Error("The selected browser element cannot accept text.");
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  })()`;
}

function browserKeyScript(key: string): string {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
    const accepted = target.dispatchEvent(event);
    if (key === "Enter" && accepted && target instanceof HTMLInputElement && target.form instanceof HTMLFormElement) {
      target.form.requestSubmit();
    }
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
  })()`;
}

const configuredBrowserSessions = new WeakSet<Session>();

function installManagedBrowserSessionPolicy(browserSession: Session): void {
  if (configuredBrowserSessions.has(browserSession)) return;
  configuredBrowserSessions.add(browserSession);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.on("will-download", (event) => event.preventDefault());
}
