import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WebSearchTool,
  type WebSearchProvider,
} from "./web-search-tool.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSearchTool", () => {
  it("returns bounded structured public web results", async () => {
    const provider: WebSearchProvider = vi.fn(() => Promise.resolve([
      {
        description: "first result",
        hostname: "example.test",
        title: "First",
        url: "https://example.test/first",
      },
      {
        description: "second result",
        hostname: "example.test",
        title: "Second",
        url: "https://example.test/second",
      },
    ]));
    const tool = new WebSearchTool(provider);

    const result = await tool.execute(
      JSON.stringify({ maxResults: 1, query: "langgraph", region: "cn-zh" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ isError: false, kind: "completed" });
    expect(result.content).toContain("https://example.test/first");
    expect(result.content).not.toContain("https://example.test/second");
    expect(provider).toHaveBeenCalledWith(
      "langgraph",
      { region: "cn-zh", safeSearch: "moderate" },
      expect.any(AbortSignal),
    );
  });

  it("returns a structured validation error without calling the provider", async () => {
    const provider: WebSearchProvider = vi.fn();
    const tool = new WebSearchTool(provider);

    const result = await tool.execute(
      JSON.stringify({ query: "" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ isError: true, kind: "completed" });
    expect(result.content).toContain("VALIDATION_FAILED");
    expect(result.content).toContain("fix_arguments");
    expect(provider).not.toHaveBeenCalled();
  });

  it("searches DuckDuckGo Lite and parses result links and snippets", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(`
      <table>
        <tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Ffirst&amp;rut=abc">First &amp; Result</a></td></tr>
        <tr><td class="result-snippet">A <b>useful</b> summary.</td></tr>
        <tr><td><a class="result-link" href="https://example.test/second">Second</a></td></tr>
        <tr><td class="result-snippet">Second summary.</td></tr>
      </table>
    `, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WebSearchTool().execute(
      JSON.stringify({ maxResults: 1, query: "langgraph", region: "cn-zh", safeSearch: "strict" }),
      new AbortController().signal,
    );
    const payload = JSON.parse(result.content) as {
      value?: { results?: WebSearchResultFixture[] };
    };

    expect(result.isError).toBe(false);
    expect(payload.value?.results).toEqual([
      {
        description: "A useful summary.",
        hostname: "example.test",
        title: "First & Result",
        url: "https://example.test/first",
      },
    ]);
    const requestedUrl = (fetchMock.mock.calls[0] as [unknown] | undefined)?.[0];
    expect(requestedUrl).toBeInstanceOf(URL);
    if (!(requestedUrl instanceof URL)) throw new Error("Expected a DuckDuckGo search URL.");
    expect(requestedUrl.origin + requestedUrl.pathname).toBe("https://lite.duckduckgo.com/lite/");
    expect(requestedUrl.searchParams.get("q")).toBe("langgraph");
    expect(requestedUrl.searchParams.get("kl")).toBe("cn-zh");
    expect(requestedUrl.searchParams.get("kp")).toBe("1");
  });

  it("rejects an oversized DuckDuckGo response before reading its body", async () => {
    let bodyRead = false;
    const oversizedResponse = {
      get body(): ReadableStream<Uint8Array> {
        bodyRead = true;
        throw new Error("The oversized body should not be read.");
      },
      headers: new Headers({ "content-length": "1000001" }),
      ok: true,
      status: 200,
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(oversizedResponse)));

    const result = await new WebSearchTool().execute(
      JSON.stringify({ query: "langgraph" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ isError: true, kind: "completed" });
    expect(result.content).toContain("VALIDATION_FAILED");
    expect(bodyRead).toBe(false);
  });
});

type WebSearchResultFixture = {
  description: string;
  hostname: string;
  title: string;
  url: string;
};
