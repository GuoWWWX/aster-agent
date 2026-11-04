// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingState, Spinner } from "./loading.js";

describe("shared loading feedback", () => {
  it("announces a card's loading label once and hides its decorative skeleton", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(<LoadingState label="正在读取文件" />);
    expect(node.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(node.querySelector('[role="status"]')?.textContent).toBe("正在读取文件");
    expect([...node.querySelectorAll(".app-loading-bone")].every(bone => bone.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("leaves a button's accessible name to its label", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(<button aria-label="保存" aria-busy="true"><Spinner size={14} /></button>);
    expect(node.querySelector(".app-spinner")?.getAttribute("aria-hidden")).toBe("true");
    expect(node.querySelector('[role="status"]')).toBeNull();
    expect(node.querySelector("button")?.getAttribute("aria-busy")).toBe("true");
  });

  it("announces a standalone spinner when it has its own accessible label", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(<Spinner aria-label="正在搜索" />);
    const status = node.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("正在搜索");
    expect(status?.hasAttribute("aria-hidden")).toBe(false);
  });
});
