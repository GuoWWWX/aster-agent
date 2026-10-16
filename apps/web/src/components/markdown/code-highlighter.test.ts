import { describe, expect, it } from "vitest";
import { highlightCode } from "./code-highlighter.js";

describe("bounded code highlighting", () => {
  it("keeps syntax highlighting for ordinary source", () => {
    expect(highlightCode('<h1 class="title">标题</h1>', "html")).toContain('class="hljs-name"');
  });
  it.each([200, 201, 250, 1000])("keeps all %i ordinary lines highlighted as streaming output grows", (lines) => {
    const source = Array.from({ length: lines }, (_, index) => `function sample${index}() { return "中文"; }`).join("\n");
    const result = highlightCode(source, "javascript");
    expect(result.match(/class="hljs-keyword"/gu)?.length).toBe(lines * 2);
    expect(result).toContain(`sample${lines - 1}`);
  });
  it("does not discard highlighting for a long line", () => {
    const result = highlightCode('<svg data-path="' + "x".repeat(2000) + '"></svg>', "html");
    expect(result).toContain('class="hljs-name"');
    expect(result).not.toContain("<svg");
  });
  it("bounds synchronous highlighting for extreme source while retaining the entire escaped remainder", () => {
    const result = highlightCode('<i>x</i>\n'.repeat(30_000) + '<script>end</script>', "html");
    expect(result).toContain('class="hljs-name"');
    expect(result).toContain("&lt;script&gt;end&lt;/script&gt;");
    expect(result.match(/<span/gu)?.length).toBeLessThan(40_000);
  });
  it("preserves an emoji crossing the synchronous highlight budget", () => {
    const source = "//" + "x".repeat(63_997) + "😀\nconst end = true;";
    expect(highlightCode(source, "javascript")).toContain("😀");
  });
});
