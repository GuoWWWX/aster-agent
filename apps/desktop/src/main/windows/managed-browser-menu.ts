const ACTION_PREFIX = "aster-browser-menu:";
export const MANAGED_BROWSER_MENU_ACTION_SIGNAL = "aster-browser-menu-action";

type BrowserMenuDownload = {
  fileName: string;
  receivedBytes: number;
  state: "cancelled" | "completed" | "interrupted" | "progressing";
  totalBytes: number;
};

type BrowserMenuHistoryEntry = {
  title: string;
  url: string;
};

export type ManagedBrowserMenuSurface =
  | { kind: "downloads"; downloads: readonly BrowserMenuDownload[] }
  | { kind: "find"; query: string }
  | { kind: "history"; entries: readonly BrowserMenuHistoryEntry[] }
  | { canFind: boolean; kind: "menu"; zoomPercent: number };

export type ManagedBrowserMenuAction = {
  action:
    | "back"
    | "clearBrowsingData"
    | "deviceToolbar"
    | "downloads"
    | "find"
    | "findQuery"
    | "history"
    | "navigateHistory"
    | "openDownload"
    | "openDownloadsFolder"
    | "openSettings"
    | "passwordSettings"
    | "print"
    | "screenshot"
    | "zoomIn"
    | "zoomOut"
    | "zoomReset";
  index?: number;
  query?: string;
};

const ALLOWED_ACTIONS = new Set<ManagedBrowserMenuAction["action"]>([
  "back",
  "clearBrowsingData",
  "deviceToolbar",
  "downloads",
  "find",
  "findQuery",
  "history",
  "navigateHistory",
  "openDownload",
  "openDownloadsFolder",
  "openSettings",
  "passwordSettings",
  "print",
  "screenshot",
  "zoomIn",
  "zoomOut",
  "zoomReset",
]);

export function managedBrowserMenuSize(surface: ManagedBrowserMenuSurface): {
  height: number;
  width: number;
} {
  switch (surface.kind) {
    case "find":
      return { height: 56, width: 320 };
    case "downloads":
      return { height: Math.min(360, Math.max(142, 94 + surface.downloads.length * 48)), width: 300 };
    case "history":
      return { height: Math.min(376, Math.max(142, 94 + surface.entries.length * 48)), width: 360 };
    case "menu":
      return { height: 352, width: 224 };
  }
}

export function parseManagedBrowserMenuAction(value: string): ManagedBrowserMenuAction | null {
  if (!value.startsWith(ACTION_PREFIX)) return null;
  const [rawAction = "", rawQuery = ""] = value.slice(ACTION_PREFIX.length).split("?", 2);
  if (!ALLOWED_ACTIONS.has(rawAction as ManagedBrowserMenuAction["action"])) return null;
  const action = rawAction as ManagedBrowserMenuAction["action"];
  const params = new URLSearchParams(rawQuery);
  const rawIndex = params.get("index");
  const index = rawIndex === null ? undefined : Number(rawIndex);
  if ((action === "navigateHistory" || action === "openDownload")
    && (index === undefined || !Number.isInteger(index) || index < 0)) return null;
  return {
    action,
    ...(index === undefined ? {} : { index }),
    ...(params.has("query") ? { query: params.get("query") ?? "" } : {}),
  };
}

export function buildManagedBrowserMenuHtml(
  surface: ManagedBrowserMenuSurface,
  colorScheme: "dark" | "light",
): string {
  const content = surfaceContent(surface);
  const bodyClass = surface.kind === "menu"
    ? "menu-body"
    : surface.kind === "downloads"
      ? "download-body"
      : undefined;
  return `<!doctype html>
<html lang="zh-CN" data-theme="${colorScheme}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <style>
    :root {
      color-scheme: light;
      --surface: #ffffff;
      --surface-soft: #f8fafc;
      --border: #dce3ec;
      --text: #334155;
      --muted: #64748b;
      --disabled: #9aa7b8;
      --hover: #eef3f8;
      --focus: #60a5fa;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --surface: #2b2b2b;
      --surface-soft: #343434;
      --border: #444444;
      --text: #f3f4f6;
      --muted: #d0d0d0;
      --disabled: #929292;
      --hover: #3a3a3a;
      --focus: #8ab4f8;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    body { color: var(--text); font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; }
    .download-body { padding: 4px; }
    .menu-body { padding: 4px; font-size: 12px; }
    .menu {
      width: 100%; height: 100%; overflow: hidden; border: 0; border-radius: 8px;
      background: var(--surface); padding: 8px 12px;
    }
    .menu-body .menu { padding: 6px 10px; }
    html[data-theme="light"] .download-body .menu { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14); }
    html[data-theme="light"] .menu-body .menu { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14); }
    .menu--list { display: flex; min-height: 0; flex-direction: column; }
    button, input { font: inherit; }
    button {
      width: 100%; min-height: 32px; border: 0; border-radius: 5px; background: transparent; color: var(--text);
      padding: 0 3px; text-align: left; cursor: default;
    }
    .menu-body button { min-height: 28px; }
    button:not(:disabled):hover { background: var(--hover); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
    button:disabled { color: var(--disabled); }
    .separator { height: 1px; flex: 0 0 auto; margin: 4px 3px; background: var(--border); }
    .menu-body .separator { margin: 2px 3px; }
    .row { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 10px; }
    .menu-body .row { min-height: 28px; }
    .row > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chevron { color: var(--muted); font-size: 20px; font-weight: 300; line-height: 1; }
    .zoom-row { min-height: 36px; }
    .menu-body .zoom-row { min-height: 32px; }
    .zoom-label { font-weight: 650; }
    .zoom-controls { display: flex; height: 28px; flex: 0 0 auto; align-items: center; }
    .zoom-controls button { width: 28px; min-height: 26px; padding: 0; color: var(--muted); text-align: center; font-size: 15px; }
    .zoom-controls button:disabled { opacity: 0.42; }
    .zoom-value { min-width: 52px; border-inline: 1px solid var(--border); color: var(--text); text-align: center; font-size: 13px; }
    .menu-body .zoom-value { font-size: 12px; }
    .zoom-group { display: flex; overflow: hidden; height: 28px; align-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-soft); }
    .zoom-reset { margin-left: 4px; }
    .panel-header { display: flex; height: 34px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px; font-weight: 700; }
    .panel-header button { width: auto; min-height: 28px; padding: 0 7px; color: var(--muted); font-size: 12px; font-weight: 500; }
    .panel-list { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 2px 0; }
    .panel-item { display: grid; min-height: 44px; grid-template-columns: minmax(0, 1fr); align-content: center; gap: 2px; padding: 4px 7px; }
    .panel-item strong, .panel-item small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-item strong { font-size: 13px; font-weight: 600; }
    .panel-item small { color: var(--muted); font-size: 11px; }
    .empty { display: grid; min-height: 72px; place-items: center; color: var(--muted); font-size: 12px; }
    .find-form { display: flex; height: 100%; align-items: center; gap: 5px; }
    .find-form input { min-width: 0; height: 30px; flex: 1 1 auto; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-soft); color: var(--text); padding: 0 8px; outline: none; }
    .find-form button { width: auto; min-height: 30px; flex: 0 0 auto; padding: 0 8px; text-align: center; }
  </style>
</head>
<body${bodyClass === undefined ? "" : ` class="${bodyClass}"`}>
  <main class="menu${surface.kind === "menu" || surface.kind === "find" ? "" : " menu--list"}">${content}</main>
  <script>
    const sendAction = (action, params = {}) => {
      const query = new URLSearchParams(params).toString();
      document.documentElement.dataset.menuAction = ${JSON.stringify(ACTION_PREFIX)} + action + (query ? "?" + query : "");
      console.debug(${JSON.stringify(MANAGED_BROWSER_MENU_ACTION_SIGNAL)});
    };
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      event.preventDefault();
      sendAction(button.dataset.action, button.dataset.index === undefined ? {} : { index: button.dataset.index });
    });
    document.querySelector("form[data-find]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      sendAction("findQuery", { query: event.currentTarget.elements.query.value });
    });
    document.querySelector("input[name=query]")?.focus();
  </script>
</body>
</html>`;
}

function surfaceContent(surface: ManagedBrowserMenuSurface): string {
  switch (surface.kind) {
    case "menu":
      return mainMenuContent(surface.zoomPercent, surface.canFind);
    case "downloads":
      return listSurfaceContent(
        "下载",
        surface.downloads.map((download, index) => ({
          action: "openDownload",
          index,
          meta: downloadStatus(download),
          title: download.fileName,
        })),
        "暂无下载内容",
        "openDownloadsFolder",
        "打开下载文件夹",
      );
    case "history":
      return listSurfaceContent(
        "历史记录",
        surface.entries.map((entry, index) => ({
          action: "navigateHistory",
          index,
          meta: entry.url,
          title: entry.title || entry.url,
        })),
        "暂无浏览记录",
      );
    case "find":
      return `<form class="find-form" data-find><input aria-label="在页面中查找" name="query" autocomplete="off" value="${escapeHtml(surface.query)}" placeholder="在页面中查找"><button type="submit">查找</button><button data-action="back" type="button">关闭</button></form>`;
  }
}

function mainMenuContent(zoomPercent: number, canFind: boolean): string {
  return `
    <button data-action="find"${canFind ? "" : " disabled"}>在页面中查找</button>
    <button data-action="print">打印</button>
    <div class="separator"></div>
    <div class="row zoom-row">
      <span class="zoom-label">缩放</span>
      <div class="zoom-controls">
        <div class="zoom-group">
          <button aria-label="缩小" data-action="zoomOut"${zoomPercent <= 25 ? " disabled" : ""}>−</button>
          <span class="zoom-value">${zoomPercent}%</span>
          <button aria-label="放大" data-action="zoomIn"${zoomPercent >= 500 ? " disabled" : ""}>＋</button>
        </div>
        <button aria-label="恢复默认缩放" class="zoom-reset" data-action="zoomReset"${zoomPercent === 100 ? " disabled" : ""}>↻</button>
      </div>
    </div>
    <div class="separator"></div>
    <button data-action="deviceToolbar">显示设备工具栏</button>
    <button data-action="screenshot">截取屏幕截图</button>
    <div class="separator"></div>
    <button disabled>导入 Cookie 和密码...</button>
    <button class="row" data-action="passwordSettings"><span>密码和自动填充</span><span class="chevron">›</span></button>
    <button data-action="downloads">下载</button>
    <button data-action="history">历史记录</button>
    <button data-action="clearBrowsingData">清除浏览数据</button>
    <div class="separator"></div>
    <button data-action="openSettings">浏览器设置</button>`;
}

function listSurfaceContent(
  title: string,
  items: readonly { action: string; index: number; meta: string; title: string }[],
  emptyLabel: string,
  headerAction?: string,
  headerActionLabel?: string,
): string {
  const renderedItems = items.length === 0
    ? `<div class="empty">${escapeHtml(emptyLabel)}</div>`
    : items.map((item) => `<button class="panel-item" data-action="${item.action}" data-index="${item.index}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.meta)}</small></button>`).join("");
  return `<header class="panel-header"><span>${escapeHtml(title)}</span>${headerAction === undefined ? "" : `<button data-action="${headerAction}">${escapeHtml(headerActionLabel ?? "")}</button>`}</header><div class="separator"></div><div class="panel-list">${renderedItems}</div>`;
}

function downloadStatus(download: BrowserMenuDownload): string {
  if (download.state === "completed") return `已完成 · ${formatBytes(download.totalBytes || download.receivedBytes)}`;
  if (download.state === "cancelled") return "已取消";
  if (download.state === "interrupted") return "已中断";
  if (download.totalBytes > 0) return `${Math.min(100, Math.round(download.receivedBytes / download.totalBytes * 100))}%`;
  return `正在下载 · ${formatBytes(download.receivedBytes)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
