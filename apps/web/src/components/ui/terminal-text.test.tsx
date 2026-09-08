import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalText, terminalHttpLinks } from "./terminal-text.js";

describe("conversation terminal colors", () => {
  it("renders ping tokens separately instead of coloring the whole command blue", () => {
    const command = renderToStaticMarkup(<TerminalText kind="command" text="ping baidu.com -n 4" />);
    for (const [tone, value] of [["info", "ping"], ["cyan", "baidu.com"], ["purple", "-n"], ["number", "4"]]) {
      expect(command).toContain(`data-terminal-tone="${tone}">${value}</span>`);
    }
    const output = renderToStaticMarkup(<TerminalText text="来自 198.18.1.58 的回复: 字节=32 时间<1ms TTL=128 (0%)" />);
    expect(output).toContain('data-terminal-tone="cyan">198.18.1.58</span>');
    expect(output).toContain('data-terminal-tone="number">1ms</span>');
    expect(output).toContain('data-terminal-tone="number">128</span>');
    expect(output).toContain('data-terminal-tone="number">0%</span>');
    expect(output.replace(/<[^>]*>/gu, "")).toBe('来自 198.18.1.58 的回复: 字节=32 时间&lt;1ms TTL=128 (0%)');
  });

  it("bounds styled spans without truncating long dense ANSI output", () => {
    const html = renderToStaticMarkup(<TerminalText text={'\x1b[31mx\x1b[32my'.repeat(10_000)} />);
    expect((html.match(/<span/g) ?? []).length).toBeLessThanOrEqual(8_001);
    expect(html.replace(/<[^>]*>/gu, "")).toBe('xy'.repeat(10_000));
  });

  it("retains a single complete hyperlink when ANSI changes inside it", () => {
    const html = renderToStaticMarkup(<TerminalText text={'https://exa\x1b[32mmple.com/\x1b[0m'} />);
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).toContain('href="https://example.com/"');
    expect(html.replace(/<[^>]*>/gu, "")).toBe('https://example.com/');
  });

  it("supports indexed foreground colors and ignores background color arguments", () => {
    const html = renderToStaticMarkup(<TerminalText text={'\x1b[38;5;196mred\x1b[0m\x1b[48;2;31;32;33mnormal'} />);
    expect(html).toContain('data-terminal-tone="rgb(255, 0, 0)">red</span>');
    expect(html).toContain('data-terminal-tone="default">normal</span>');
  });

  it("colors fatal output and nonzero exit codes, leaving ordinary text neutral", () => {
    const html = renderToStaticMarkup(<TerminalText text={'ordinary output\nfatal: not a git repository\n[进程退出代码: 1]'} />);
    expect(html).toContain('data-terminal-tone="error"');
    expect(html).toContain('fatal: not a git repository</span>');
    expect(html).toContain('[进程退出代码: 1]</span>');
    expect(html).toContain('data-terminal-tone="default"');
  });

  it("distinguishes warning, success and commands without coloring incidental words", () => {
    const html = renderToStaticMarkup(<TerminalText text={'WARN deprecated API\n✓ built in 1s\n0 errors\n[进程退出代码: 0]'} />);
    expect(html).toContain('data-terminal-tone="warning"');
    expect(html).toContain('data-terminal-tone="success"');
    expect(html).toContain('data-terminal-tone="number">0</span>');
    expect(html).toContain('data-terminal-tone="default"> errors</span>');
    expect(renderToStaticMarkup(<TerminalText text="git status --short" kind="command" />))
      .toContain('data-terminal-tone="info"');
  });

  it("renders ANSI foreground colors and reset without interpreting HTML or OSC links", () => {
    const text = '\x1b[31mred\x1b[0m plain\n\x1b[32mhttps://example.com/\x1b[0m\n\x1b]8;;javascript:alert(1)\x07<script>\x1b]8;;\x07';
    const html = renderToStaticMarkup(<TerminalText text={text} />);
    expect(html).toContain('data-terminal-tone="error">red</span>');
    expect(html).toContain('data-terminal-tone="success"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('\x1b');
    expect(text).toContain('\x1b[31m');
  });

  it("handles streamed color sequences and does not treat RGB arguments as SGR colors", () => {
    expect(renderToStaticMarkup(<TerminalText text={'hello\x1b[3'} />)).not.toContain('\x1b');
    const html = renderToStaticMarkup(<TerminalText text={'\x1b[32mfirst\nsecond\x1b[39m normal\n\x1b[38;2;31;32;33mRGB'} />);
    expect(html).toContain('data-terminal-tone="success">second</span>');
    expect(html).toContain('data-terminal-tone="rgb(31, 32, 33)">RGB</span>');
    expect(html).toContain('light-dark(');
  });
});

describe("terminal HTTP links", () => {
  it("recognizes local ports, query strings, IPv6 and balanced parentheses", () => {
    const urls = ["http://localhost:5173/", "https://example.com/a?q=1&b=2#part", "http://[::1]:3000/", "https://example.com/a(b)"];
    expect(terminalHttpLinks(urls.join("\n")).map((link) => link.url)).toEqual(urls);
  });
  it("excludes prose punctuation without changing displayed text", () => {
    const text = "访问 (https://example.com/path)。\nhttp://localhost:5173/";
    expect(terminalHttpLinks(text)[0]?.url).toBe("https://example.com/path");
    expect(renderToStaticMarkup(<TerminalText text={text} />)).toContain('</a><span class="text-[var(--app-foreground)]" data-terminal-tone="default">)。</span>');
  });
  it("leaves dangerous protocols, malformed URLs and credential URLs unlinked", () => {
    expect(terminalHttpLinks("javascript:alert(1) file:///C:/x https://user:secret@example.com http:// http://exa\\mple.com"))
      .toEqual([]);
  });
  it("escapes output HTML and gives links safe new-window attributes", () => {
    const html = renderToStaticMarkup(<TerminalText text={'<script>alert(1)</script> https://example.com/'} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});
