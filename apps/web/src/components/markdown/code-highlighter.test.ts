import { describe, expect, it } from "vitest";
import { highlightCode } from "./code-highlighter.js";

describe("bounded code highlighting", () => {
  it("keeps syntax highlighting for ordinary source", () => {
    expect(highlightCode('<h1 class="title">标题</h1>', "html")).toContain('class="hljs-name"');
  });
  it("escapes large, long-line and many-line source without generating thousands of spans", () => {
    for (const source of ['<b title="x">内容</b>\n'.repeat(1500), '<svg data-path="' + "x".repeat(2000) + '"></svg>', "<i>x</i>\n".repeat(300)]) {
      const result = highlightCode(source, "html");
      expect(result.includes("<span")).toBe(false);
      expect(result).toContain("&lt;");
      expect(result).not.toContain("<svg");
    }
  });
});
