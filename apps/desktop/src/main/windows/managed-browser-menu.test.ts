import { describe, expect, it } from "vitest";

import {
  buildManagedBrowserMenuHtml,
  managedBrowserMenuSize,
  parseManagedBrowserMenuAction,
} from "./managed-browser-menu.js";

describe("managed browser menu", () => {
  it("renders the requested browser-menu groups in stable order", () => {
    const html = buildManagedBrowserMenuHtml({ canFind: true, kind: "menu", zoomPercent: 100 }, "dark");
    const labels = [
      "在页面中查找",
      "打印",
      "缩放",
      "显示设备工具栏",
      "截取屏幕截图",
      "导入 Cookie 和密码...",
      "密码和自动填充",
      "下载",
      "历史记录",
      "清除浏览数据",
      "浏览器设置",
    ];
    for (let index = 1; index < labels.length; index++) {
      expect(html.indexOf(labels[index - 1]!)).toBeLessThan(html.indexOf(labels[index]!));
    }
    expect(html).toContain("border-radius: 8px");
    expect(html).toContain(".menu-body { padding: 4px; font-size: 12px; }");
    expect(html).toContain(".menu-body .zoom-value { font-size: 12px; }");
    expect(html).toContain(".menu-body .menu { padding: 6px 10px; }");
    expect(html).toContain(".menu-body button { min-height: 28px; }");
    expect(html).toContain(".menu-body .separator { margin: 2px 3px; }");
    expect(html).toContain(".zoom-row { min-height: 32px; }");
    expect(html).toContain('html[data-theme="light"] .menu-body .menu { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14); }');
    expect(html).toContain("data-action=\"zoomOut\"");
    expect(html).toContain("data-action=\"zoomIn\"");
    expect(html).toContain("dataset.menuAction = \"aster-browser-menu:\"");
    expect(html).toContain('console.debug("aster-browser-menu-action:"');
    expect(managedBrowserMenuSize({ canFind: true, kind: "menu", zoomPercent: 100 }))
      .toEqual({ height: 352, width: 224 });
  });

  it("escapes list content and validates menu action URLs", () => {
    const html = buildManagedBrowserMenuHtml({
      entries: [{ title: "<script>", url: "https://example.com/?a=1&b=2" }],
      kind: "history",
    }, "light");
    expect(html).not.toContain("<script></strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(parseManagedBrowserMenuAction("aster-browser-menu:navigateHistory?index=2"))
      .toEqual({ action: "navigateHistory", index: 2 });
    expect(parseManagedBrowserMenuAction("aster-browser-menu:findQuery?query=hello%20world"))
      .toEqual({ action: "findQuery", query: "hello world" });
    expect(parseManagedBrowserMenuAction("https://example.com/")).toBeNull();
    expect(parseManagedBrowserMenuAction("aster-browser-menu:openDownload?index=-1")).toBeNull();
  });

  it("renders page-find navigation, result count, and close controls", () => {
    const html = buildManagedBrowserMenuHtml({
      activeMatchOrdinal: 2,
      kind: "find",
      matches: 7,
      query: "Aster",
    }, "dark");

    expect(html).toContain("2 / 7");
    expect(html).toContain('data-action="findPrevious"');
    expect(html).toContain('data-action="findNext"');
    expect(html).toContain('aria-label="关闭查找"');
    expect(html).toContain('event.key !== "Escape"');
    expect(managedBrowserMenuSize({
      activeMatchOrdinal: 0,
      kind: "find",
      matches: 0,
      query: "",
    })).toEqual({ height: 56, width: 440 });
  });

  it("keeps the download panel compact and separated from the page in light mode", () => {
    const html = buildManagedBrowserMenuHtml({ downloads: [], kind: "downloads" }, "light");

    expect(html).toContain('<body class="download-body">');
    expect(html).toContain(".download-body { padding: 4px; }");
    expect(html).toContain('html[data-theme="light"] .download-body .menu { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14); }');
    expect(managedBrowserMenuSize({ downloads: [], kind: "downloads" }))
      .toEqual({ height: 142, width: 300 });
  });
});
