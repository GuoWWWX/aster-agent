import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  session as electronSession,
  shell,
  WebContentsView,
  type DownloadItem,
  type Event as ElectronEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
  type WebContents,
} from "electron";

import {
  managedBrowserEventSchema,
  managedBrowserSessionSchema,
  managedBrowserSnapshotSchema,
  type BrowserConfiguration,
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

import {
  buildManagedBrowserMenuHtml,
  MANAGED_BROWSER_MENU_ACTION_SIGNAL,
  managedBrowserMenuSize,
  parseManagedBrowserMenuAction,
  type ManagedBrowserMenuAction,
  type ManagedBrowserMenuSurface,
} from "./managed-browser-menu.js";

import { z } from "zod";

const MANAGED_BROWSER_PARTITION = "persist:aster-managed-browser";
const TITLEBAR_HEIGHT = 36;
const MANAGED_BROWSER_ZOOM_BASE_FACTOR = 0.8;
const ZOOM_PERCENT_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const;
const SEARCH_ENGINE_URLS: Record<BrowserConfiguration["searchEngine"], string> = {
  bing: "https://www.bing.com/search",
  duckduckgo: "https://duckduckgo.com/",
  google: "https://www.google.com/search",
};

type BrowserPageState = Omit<ManagedBrowserSession, "sessionId">;
type BrowserEventListener = (event: ManagedBrowserEvent) => void;
type BrowserDownload = {
  fileName: string;
  receivedBytes: number;
  savePath: string;
  state: "cancelled" | "completed" | "interrupted" | "progressing";
  totalBytes: number;
};
type BrowserHistoryEntry = {
  title: string;
  url: string;
  visitedAt: string;
};
type BrowserMenuOverlay = {
  anchorX: number;
  anchorY: number;
  kind: ManagedBrowserMenuSurface["kind"];
  query: string;
  renderVersion: number;
  sessionId: string;
  view: WebContentsView;
};
type BrowserMenuCommandInput = Extract<
  ManagedBrowserCommandInput,
  { command: "showDownloads" | "showMenu" }
>;

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

export function managedBrowserZoomFactor(zoomPercent: number): number {
  return zoomPercent / 100 * MANAGED_BROWSER_ZOOM_BASE_FACTOR;
}

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
  getDownloads(): readonly BrowserDownload[];
  getHistory(): readonly BrowserHistoryEntry[];
  getState(): BrowserPageState;
  findInPage(query: string): void;
  load(url: string): Promise<void>;
  onError(listener: (message: string) => void): () => void;
  onStateChanged(listener: () => void): () => void;
  openDevTools(): void;
  interact?(input: ManagedBrowserInteraction): Promise<void>;
  observe?(): Promise<ManagedBrowserObservation>;
  print(): Promise<void>;
  reload(): Promise<void>;
  saveScreenshot(): Promise<void>;
  setAskForDownloadLocation(enabled: boolean): void;
  setBounds(bounds: Rectangle): void;
  setColorScheme(colorScheme: "light" | "dark"): Promise<void>;
  setVisible(visible: boolean): void;
  setZoomPercent(percent: number): void;
  showStartPage(): Promise<void>;
  stop(): void;
  stopFindInPage(): void;
  toggleDeviceToolbar(): void;
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
  private browserMenuOverlay: BrowserMenuOverlay | undefined;
  private colorScheme: "light" | "dark" = nativeTheme.shouldUseDarkColors ? "dark" : "light";
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
    const configuration = this.browserConfiguration.getConfiguration();
    const sessionId = randomUUID();
    const disposeState = page.onStateChanged(() => this.emitState(sessionId));
    const disposeError = page.onError((message) => {
      this.emit({ message, sessionId, type: "error" });
    });
    this.sessions.set(sessionId, { disposeError, disposeState, page });
    try {
      await page.showStartPage();
      await page.setColorScheme(this.colorScheme);
      if (input.url !== undefined) {
        await page.load(resolveManagedBrowserAddress(input.url, configuration.searchEngine));
      }
      page.setAskForDownloadLocation(configuration.askForDownloadLocation);
      page.setZoomPercent(configuration.defaultZoomPercent);
      return this.sessionState(sessionId);
    } catch (error) {
      this.close({ sessionId });
      throw error;
    }
  }

  public async navigate(input: ManagedBrowserNavigateInput): Promise<void> {
    const { searchEngine } = this.browserConfiguration.getConfiguration();
    await this.requireSession(input.sessionId).page.load(
      resolveManagedBrowserAddress(input.url, searchEngine),
    );
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
        await page.reload();
        return;
      case "resetZoom":
        page.setZoomPercent(100);
        return;
      case "showMenu":
        this.showMenu(input);
        return;
      case "showDownloads":
        this.showDownloads(input);
        return;
      case "setColorScheme":
        this.colorScheme = input.colorScheme;
        nativeTheme.themeSource = input.colorScheme;
        await page.setColorScheme(input.colorScheme);
        if (this.browserMenuOverlay?.sessionId === input.sessionId) {
          this.renderBrowserMenuOverlayInBackground(this.browserMenuOverlay);
        }
        return;
      case "showWorkspaceAddMenu":
        this.showWorkspaceAddMenu(input);
        return;
      case "showWorkspaceTabMenu":
        this.showWorkspaceTabMenu(input);
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
    if (this.browserMenuOverlay?.sessionId === input.sessionId) this.closeBrowserMenuOverlay();
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
    this.closeBrowserMenuOverlay();
    this.listeners.clear();
    for (const sessionId of [...this.sessions.keys()]) this.close({ sessionId });
  }

  private emitState(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.emit({ session: this.sessionState(sessionId), type: "state" });
  }

  public async clearBrowsingData(): Promise<void> {
    if (this.sessions.size === 0) {
      await electronSession.fromPartition(MANAGED_BROWSER_PARTITION).clearData();
      return;
    }
    for (const session of this.sessions.values()) await session.page.clearBrowsingData();
  }

  public applyConfiguration(configuration: BrowserConfiguration): void {
    for (const session of this.sessions.values()) {
      session.page.setAskForDownloadLocation(configuration.askForDownloadLocation);
    }
  }

  private showMenu(
    input: BrowserMenuCommandInput,
  ): void {
    this.showBrowserMenuOverlay(input, "menu");
  }

  private showDownloads(
    input: BrowserMenuCommandInput,
  ): void {
    this.showBrowserMenuOverlay(input, "downloads");
  }

  private showBrowserMenuOverlay(
    input: BrowserMenuCommandInput,
    kind: BrowserMenuOverlay["kind"],
  ): void {
    const window = this.requireWindow();
    this.requireSession(input.sessionId);
    this.closeBrowserMenuOverlay();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    window.contentView.addChildView(view);
    const overlay: BrowserMenuOverlay = {
      anchorX: input.x,
      anchorY: input.y,
      kind,
      query: "",
      renderVersion: 0,
      sessionId: input.sessionId,
      view,
    };
    this.browserMenuOverlay = overlay;
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, url) => {
      const action = parseManagedBrowserMenuAction(url);
      event.preventDefault();
      if (action !== null) this.handleBrowserMenuAction(overlay, action);
    });
    view.webContents.on("console-message", (details) => {
      if (!details.sourceId.startsWith("data:text/html")
        || details.message !== MANAGED_BROWSER_MENU_ACTION_SIGNAL) return;
      void view.webContents.executeJavaScript(
        "document.documentElement.dataset.menuAction ?? ''",
        true,
      ).then((value: unknown) => {
        if (this.browserMenuOverlay !== overlay || typeof value !== "string") return;
        const action = parseManagedBrowserMenuAction(value);
        if (action !== null) this.handleBrowserMenuAction(overlay, action);
      }).catch(() => undefined);
    });
    view.webContents.once("did-finish-load", () => {
      if (this.browserMenuOverlay !== overlay || view.webContents.isDestroyed()) return;
      view.setVisible(true);
      view.webContents.focus();
      view.webContents.once("blur", () => {
        if (this.browserMenuOverlay === overlay) this.closeBrowserMenuOverlay();
      });
    });
    this.renderBrowserMenuOverlayInBackground(overlay);
  }

  private handleBrowserMenuAction(
    overlay: BrowserMenuOverlay,
    input: ManagedBrowserMenuAction,
  ): void {
    if (this.browserMenuOverlay !== overlay) return;
    const window = this.requireWindow();
    const page = this.requireSession(overlay.sessionId).page;
    switch (input.action) {
      case "back":
        this.closeBrowserMenuOverlay();
        return;
      case "find":
        overlay.kind = "find";
        this.renderBrowserMenuOverlayInBackground(overlay);
        return;
      case "findQuery":
        overlay.query = input.query?.slice(0, 500) ?? "";
        if (overlay.query.length > 0) page.findInPage(overlay.query);
        return;
      case "print":
        this.closeBrowserMenuOverlay();
        this.runMenuAction(overlay.sessionId, () => page.print(), "打印失败。");
        return;
      case "zoomOut":
        page.zoomOut();
        this.renderBrowserMenuOverlayInBackground(overlay);
        return;
      case "zoomReset":
        page.setZoomPercent(100);
        this.renderBrowserMenuOverlayInBackground(overlay);
        return;
      case "zoomIn":
        page.zoomIn();
        this.renderBrowserMenuOverlayInBackground(overlay);
        return;
      case "deviceToolbar":
        this.closeBrowserMenuOverlay();
        page.toggleDeviceToolbar();
        return;
      case "screenshot":
        this.closeBrowserMenuOverlay();
        this.runMenuAction(overlay.sessionId, () => page.saveScreenshot(), "截图保存失败。");
        return;
      case "passwordSettings":
      case "openSettings":
        this.closeBrowserMenuOverlay();
        this.emit({ sessionId: overlay.sessionId, type: "openSettings" });
        return;
      case "downloads":
        overlay.kind = "downloads";
        void this.renderBrowserMenuOverlay(overlay);
        return;
      case "history":
        overlay.kind = "history";
        void this.renderBrowserMenuOverlay(overlay);
        return;
      case "clearBrowsingData":
        this.closeBrowserMenuOverlay();
        this.runMenuAction(
          overlay.sessionId,
          () => this.confirmAndClearBrowsingData(window, page),
          "清除浏览数据失败。",
        );
        return;
      case "openDownloadsFolder":
        this.closeBrowserMenuOverlay();
        this.openDownloadedFile(overlay.sessionId, app.getPath("downloads"));
        return;
      case "openDownload": {
        const download = page.getDownloads()[input.index ?? -1];
        if (download === undefined || download.state !== "completed") return;
        this.closeBrowserMenuOverlay();
        this.openDownloadedFile(overlay.sessionId, download.savePath);
        return;
      }
      case "navigateHistory": {
        const entry = page.getHistory()[input.index ?? -1];
        if (entry === undefined) return;
        this.closeBrowserMenuOverlay();
        this.runMenuAction(overlay.sessionId, () => page.load(entry.url), "历史页面打开失败。");
      }
    }
  }

  private renderBrowserMenuOverlayInBackground(overlay: BrowserMenuOverlay): void {
    void this.renderBrowserMenuOverlay(overlay).catch(() => {
      if (this.browserMenuOverlay !== overlay) return;
      const { sessionId } = overlay;
      this.closeBrowserMenuOverlay();
      this.emit({
        message: "浏览器菜单暂时无法显示，请重试。",
        sessionId,
        type: "error",
      });
    });
  }

  private async renderBrowserMenuOverlay(overlay: BrowserMenuOverlay): Promise<void> {
    if (this.browserMenuOverlay !== overlay || overlay.view.webContents.isDestroyed()) return;
    const renderVersion = ++overlay.renderVersion;
    const window = this.requireWindow();
    const page = this.requireSession(overlay.sessionId).page;
    const state = page.getState();
    const surface: ManagedBrowserMenuSurface = overlay.kind === "menu"
      ? { canFind: state.url.length > 0, kind: "menu", zoomPercent: state.zoomPercent }
      : overlay.kind === "downloads"
        ? { downloads: page.getDownloads(), kind: "downloads" }
        : overlay.kind === "history"
          ? { entries: page.getHistory(), kind: "history" }
          : { kind: "find", query: overlay.query };
    const requestedSize = managedBrowserMenuSize(surface);
    const [contentWidth = 0, contentHeight = 0] = window.getContentSize();
    const width = Math.min(requestedSize.width, Math.max(1, contentWidth));
    const height = Math.min(requestedSize.height, Math.max(1, contentHeight - TITLEBAR_HEIGHT));
    const x = Math.min(Math.max(0, overlay.anchorX - width), Math.max(0, contentWidth - width));
    const y = Math.min(
      Math.max(TITLEBAR_HEIGHT, overlay.anchorY + 4),
      Math.max(TITLEBAR_HEIGHT, contentHeight - height),
    );
    overlay.view.setBounds({ height, width, x, y });
    const html = buildManagedBrowserMenuHtml(
      surface,
      this.colorScheme,
    );
    try {
      await overlay.view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    } catch (error) {
      if (this.browserMenuOverlay !== overlay
        || overlay.view.webContents.isDestroyed()
        || overlay.renderVersion !== renderVersion) return;
      throw error;
    }
  }

  private closeBrowserMenuOverlay(): void {
    const overlay = this.browserMenuOverlay;
    if (overlay === undefined) return;
    this.browserMenuOverlay = undefined;
    if (overlay.kind === "find") this.sessions.get(overlay.sessionId)?.page.stopFindInPage();
    const window = this.getMainWindow();
    if (window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(overlay.view);
    if (!overlay.view.webContents.isDestroyed()) overlay.view.webContents.close();
  }

  private openDownloadedFile(sessionId: string, targetPath: string): void {
    void shell.openPath(targetPath).then((message) => {
      if (message.length > 0) throw new Error(message);
    }).catch((error: unknown) => {
      this.emit({
        message: error instanceof Error ? error.message : "无法打开下载内容。",
        sessionId,
        type: "error",
      });
    });
  }

  private showWorkspaceAddMenu(
    input: Extract<ManagedBrowserCommandInput, { command: "showWorkspaceAddMenu" }>,
  ): void {
    const window = this.requireWindow();
    this.requireSession(input.sessionId);
    const emitAction = (
      action: Extract<ManagedBrowserEvent, { type: "workspaceAddMenu" }>["action"],
    ): void => {
      this.emit({ action, sessionId: input.sessionId, type: "workspaceAddMenu" });
    };
    const template: MenuItemConstructorOptions[] = [
      {
        click: () => emitAction("openGitReview"),
        enabled: input.canOpenGitReview,
        label: "审阅",
      },
      {
        click: () => emitAction("openTerminal"),
        enabled: input.canOpenTerminal,
        label: "终端",
      },
      {
        click: () => emitAction("openBrowser"),
        label: "浏览器",
      },
      {
        click: () => emitAction("openFiles"),
        label: "文件",
      },
      {
        click: () => emitAction("createSideChat"),
        enabled: input.canCreateSideChat,
        label: "侧边聊天",
      },
    ];
    Menu.buildFromTemplate(template).popup({ window, x: input.x, y: input.y });
  }

  private showWorkspaceTabMenu(
    input: Extract<ManagedBrowserCommandInput, { command: "showWorkspaceTabMenu" }>,
  ): void {
    const window = this.requireWindow();
    this.requireSession(input.sessionId);
    const emitAction = (
      action: Extract<ManagedBrowserEvent, { type: "workspaceTabMenu" }>["action"],
    ): void => {
      this.emit({ action, sessionId: input.sessionId, type: "workspaceTabMenu" });
    };
    const template: MenuItemConstructorOptions[] = [
      {
        click: () => emitAction("close"),
        label: "关闭",
      },
      {
        click: () => emitAction("closeOthers"),
        enabled: input.canCloseOthers,
        label: "关闭其他",
      },
      {
        click: () => emitAction("closeAll"),
        label: "关闭全部",
      },
    ];
    Menu.buildFromTemplate(template).popup({ window, x: input.x, y: input.y });
  }

  private runMenuAction(
    sessionId: string,
    action: () => Promise<void>,
    fallbackMessage: string,
  ): void {
    void action().catch((error: unknown) => {
      if (isCancelledBrowserAction(error)) return;
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

function isCancelledBrowserAction(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ERR_ABORTED";
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

export function resolveManagedBrowserAddress(
  value: string,
  searchEngine: BrowserConfiguration["searchEngine"] = "google",
): string {
  const trimmed = value.trim();
  if (isLikelyBrowserHost(trimmed)) {
    return normalizeManagedBrowserUrl(`https://${trimmed}`);
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed)) {
    return normalizeManagedBrowserUrl(trimmed);
  }
  const searchUrl = new URL(SEARCH_ENGINE_URLS[searchEngine]);
  searchUrl.searchParams.set("q", trimmed);
  return searchUrl.href;
}

export async function reloadManagedBrowserPage(
  currentUrl: string,
  nativeReload: () => void,
  restoreStartPage: () => Promise<void>,
): Promise<void> {
  if (currentUrl === "about:blank") {
    await restoreStartPage();
    return;
  }
  nativeReload();
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
  view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff");
  view.setVisible(false);
  const webContents = view.webContents;
  const downloads: BrowserDownload[] = [];
  const history: BrowserHistoryEntry[] = [];
  const stateListeners = new Set<() => void>();
  const errorListeners = new Set<(message: string) => void>();
  let askForDownloadLocation = false;
  let closed = false;
  let colorScheme: "light" | "dark" = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  let zoomPercent = 100;
  let observationSequence = 0;
  const applyZoomPercent = (percent: number): void => {
    zoomPercent = Math.min(500, Math.max(25, Math.round(percent)));
    webContents.setZoomFactor(managedBrowserZoomFactor(zoomPercent));
  };
  const emitState = (): void => {
    for (const listener of stateListeners) listener();
  };
  const emitError = (message: string): void => {
    for (const listener of errorListeners) listener(message);
  };
  const showStartPage = async (): Promise<void> => {
    await webContents.loadURL("about:blank");
    await webContents.executeJavaScript(managedBrowserStartPageScript(), true);
  };
  const recordHistory = (url: string): void => {
    if (!/^https?:/iu.test(url)) return;
    const previous = history[0];
    if (previous?.url === url) {
      previous.visitedAt = new Date().toISOString();
      return;
    }
    history.unshift({ title: webContents.getTitle(), url, visitedAt: new Date().toISOString() });
    if (history.length > 100) history.length = 100;
  };
  const handleDownload = (
    _event: ElectronEvent,
    item: DownloadItem,
    source: WebContents,
  ): void => {
    if (source.id !== webContents.id) return;
    const download: BrowserDownload = {
      fileName: item.getFilename() || "download",
      receivedBytes: 0,
      savePath: "",
      state: "progressing",
      totalBytes: Math.max(0, item.getTotalBytes()),
    };
    if (askForDownloadLocation) {
      item.setSaveDialogOptions({
        defaultPath: path.join(app.getPath("downloads"), download.fileName),
      });
    } else {
      download.savePath = resolveBrowserDownloadPath(download.fileName, downloads);
      item.setSavePath(download.savePath);
    }
    downloads.unshift(download);
    if (downloads.length > 50) downloads.length = 50;
    const updateDownload = (state: BrowserDownload["state"]): void => {
      download.receivedBytes = Math.max(0, item.getReceivedBytes());
      download.totalBytes = Math.max(0, item.getTotalBytes());
      download.savePath = item.getSavePath();
      download.state = state;
    };
    item.on("updated", (_downloadEvent, state) => updateDownload(state));
    item.once("done", (_downloadEvent, state) => updateDownload(state));
  };
  webContents.session.on("will-download", handleDownload);
  webContents.on("did-start-loading", emitState);
  webContents.on("did-stop-loading", emitState);
  webContents.on("devtools-closed", () => {
    if (closed || webContents.isDestroyed()) return;
    void applyManagedBrowserColorScheme(webContents, colorScheme).catch((error: unknown) => {
      emitError(error instanceof Error ? error.message : "浏览器主题恢复失败。");
    });
  });
  webContents.on("did-navigate", (_event, url) => {
    applyZoomPercent(zoomPercent);
    recordHistory(url);
    emitState();
  });
  webContents.on("did-navigate-in-page", emitState);
  webContents.on("page-title-updated", (_event, title) => {
    const current = history.find((entry) => entry.url === webContents.getURL());
    if (current !== undefined) current.title = title;
    emitState();
  });
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
      history.length = 0;
      await reloadManagedBrowserPage(
        webContents.getURL(),
        () => webContents.reload(),
        showStartPage,
      );
    },
    close: () => {
      closed = true;
      stateListeners.clear();
      errorListeners.clear();
      webContents.session.removeListener("will-download", handleDownload);
      window.contentView.removeChildView(view);
      if (webContents.debugger.isAttached()) webContents.debugger.detach();
      if (!webContents.isDestroyed()) webContents.close();
    },
    forward: () => {
      if (webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
    },
    findInPage: (query) => {
      if (query.length > 0) webContents.findInPage(query);
    },
    getDownloads: () => downloads.map((download) => ({ ...download })),
    getHistory: () => history.map((entry) => ({ ...entry })),
    getState: () => ({
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: webContents.isLoading(),
      title: webContents.getTitle(),
      url: webContents.getURL() === "about:blank" ? "" : webContents.getURL(),
      zoomPercent,
    }),
    load: async (url) => {
      await applyManagedBrowserColorScheme(webContents, colorScheme, url);
    },
    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onStateChanged: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    openDevTools: () => {
      if (webContents.debugger.isAttached()) webContents.debugger.detach();
      webContents.openDevTools({ mode: "detach" });
    },
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
    reload: () => reloadManagedBrowserPage(
      webContents.getURL(),
      () => webContents.reload(),
      showStartPage,
    ),
    saveScreenshot: async () => {
      const image = await webContents.capturePage();
      const png = image.toPNG();
      const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "");
      const fileName = `Aster 截图 ${timestamp}.png`;
      const savePath = resolveBrowserDownloadPath(fileName, downloads);
      await writeFile(savePath, png);
      downloads.unshift({
        fileName,
        receivedBytes: png.byteLength,
        savePath,
        state: "completed",
        totalBytes: png.byteLength,
      });
      if (downloads.length > 50) downloads.length = 50;
    },
    setAskForDownloadLocation: (enabled) => {
      askForDownloadLocation = enabled;
    },
    setBounds: (bounds) => view.setBounds(bounds),
    setColorScheme: async (nextColorScheme) => {
      const changed = colorScheme !== nextColorScheme;
      colorScheme = nextColorScheme;
      view.setBackgroundColor(nextColorScheme === "dark" ? "#171717" : "#ffffff");
      await applyManagedBrowserColorScheme(
        webContents,
        nextColorScheme,
        undefined,
        changed && /^https?:/iu.test(webContents.getURL()),
      );
    },
    setVisible: (visible) => view.setVisible(visible),
    setZoomPercent: (percent) => {
      applyZoomPercent(percent);
      emitState();
    },
    showStartPage,
    stop: () => webContents.stop(),
    stopFindInPage: () => webContents.stopFindInPage("clearSelection"),
    toggleDeviceToolbar: () => {
      const toggle = (): void => {
        const devTools = webContents.devToolsWebContents;
        if (devTools === null || devTools.isDestroyed()) return;
        devTools.sendInputEvent({
          keyCode: "M",
          modifiers: ["control", "shift"],
          type: "keyDown",
        });
        devTools.sendInputEvent({ keyCode: "M", type: "keyUp" });
      };
      if (webContents.isDevToolsOpened()) toggle();
      else {
        webContents.once("devtools-opened", toggle);
        webContents.openDevTools({ mode: "detach" });
      }
    },
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

function resolveBrowserDownloadPath(
  fileName: string,
  downloads: readonly BrowserDownload[],
): string {
  const safeFileName = path.basename(fileName) || "download";
  const parsed = path.parse(safeFileName);
  const reservedPaths = new Set(downloads.map((download) => download.savePath.toLocaleLowerCase("en-US")));
  for (let index = 0; index < 1_000; index++) {
    const candidateName = index === 0
      ? safeFileName
      : `${parsed.name} (${index})${parsed.ext}`;
    const candidatePath = path.join(app.getPath("downloads"), candidateName);
    if (!existsSync(candidatePath) && !reservedPaths.has(candidatePath.toLocaleLowerCase("en-US"))) {
      return candidatePath;
    }
  }
  return path.join(app.getPath("downloads"), `${randomUUID()}-${safeFileName}`);
}

async function applyManagedBrowserColorScheme(
  webContents: WebContents,
  colorScheme: "dark" | "light",
  navigateUrl?: string,
  reload = false,
): Promise<void> {
  const browserDebugger = webContents.debugger;
  if (!browserDebugger.isAttached()) browserDebugger.attach("1.3");
  await browserDebugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: colorScheme }],
  });
  await browserDebugger.sendCommand(
    "Emulation.setAutoDarkModeOverride",
    colorScheme === "dark" ? { enabled: true } : {},
  );
  if (colorScheme === "light" && browserDebugger.isAttached()) browserDebugger.detach();
  if (navigateUrl !== undefined) await webContents.loadURL(navigateUrl);
  else if (reload) {
    await new Promise<void>((resolve, reject) => {
      const onNavigate = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        webContents.removeListener("did-navigate", onNavigate);
        reject(new Error("浏览器主题切换超时。"));
      }, 10_000);
      webContents.once("did-navigate", onNavigate);
      webContents.reloadIgnoringCache();
    });
    webContents.reloadIgnoringCache();
  }
}

function managedBrowserStartPageScript(): string {
  return `(() => {
    document.documentElement.style.colorScheme = "light dark";
    document.body.innerHTML = \`
      <main class="aster-start-page">
        <div class="aster-start-page__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>
          </svg>
        </div>
        <h1>开始浏览</h1>
        <p>在上方输入网址或搜索内容</p>
        <span>按 Enter 打开页面</span>
      </main>
    \`;
    const style = document.createElement("style");
    style.textContent = \`
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        overflow: hidden;
        background: #ffffff;
        color: #334155;
        font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      .aster-start-page {
        min-height: 100%;
        display: grid;
        place-content: center;
        justify-items: center;
        padding: 32px;
        transform: translateY(-4vh);
        text-align: center;
      }
      .aster-start-page__icon {
        display: grid;
        width: 56px;
        height: 56px;
        margin-bottom: 18px;
        place-items: center;
        border: 1px solid #dbe3ee;
        border-radius: 18px;
        background: #f8fafc;
        color: #64748b;
      }
      .aster-start-page__icon svg { width: 30px; height: 30px; }
      h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
      p { margin: 10px 0 0; color: #64748b; font-size: 14px; }
      span {
        margin-top: 16px;
        padding: 5px 10px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #94a3b8;
        font-size: 12px;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #171717; color: #e5e7eb; }
        .aster-start-page__icon {
          border-color: #343434;
          background: #202020;
          color: #a3a3a3;
        }
        p { color: #a3a3a3; }
        span { background: #242424; color: #737373; }
      }
    \`;
    document.head.replaceChildren(style);
    document.title = "新标签页";
  })()`;
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
}
