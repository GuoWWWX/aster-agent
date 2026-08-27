import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";

import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import type { ToolExecution, ToolExecutionResult } from "./project-tool-registry.js";
import type { ToolExecutionPolicy } from "./tool-execution-policy.js";

const MAX_QUERY_LENGTH = 400;
const MAX_RESULT_TITLE_LENGTH = 300;
const MAX_RESULT_DESCRIPTION_LENGTH = 1_200;
const MAX_RESPONSE_LENGTH = 1_000_000;
const SEARCH_TIMEOUT_MS = 20_000;
const DUCKDUCKGO_LITE_URL = "https://lite.duckduckgo.com/lite/";

const webSearchArgumentsSchema = z.object({
  maxResults: z.number().int().min(1).max(10).default(5)
    .describe("Maximum number of web results to return."),
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH)
    .describe("The web search query."),
  region: z.string().trim().min(2).max(32).default("wt-wt")
    .describe("DuckDuckGo region code, for example cn-zh or wt-wt."),
  safeSearch: z.enum(["strict", "moderate", "off"]).default("moderate")
    .describe("Safe-search filtering level."),
}).strict();

export type WebSearchResult = {
  description: string;
  hostname: string;
  title: string;
  url: string;
};

export type WebSearchProvider = (
  query: string,
  options: { region: string; safeSearch: "strict" | "moderate" | "off" },
  signal: AbortSignal,
) => Promise<readonly WebSearchResult[]>;

function resultHostname(url: string, fallback: string): string {
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}

const defaultWebSearchProvider: WebSearchProvider = searchDuckDuckGoLite;

async function searchDuckDuckGoLite(
  query: string,
  options: { region: string; safeSearch: "strict" | "moderate" | "off" },
  signal: AbortSignal,
): Promise<readonly WebSearchResult[]> {
  const url = new URL(DUCKDUCKGO_LITE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("kl", options.region);
  url.searchParams.set("kp", liteSafeSearchValue(options.safeSearch));
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);
  const response = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": "Aster web_search/1.0",
    },
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo Lite returned HTTP ${response.status}.`);
  }
  const html = await readBoundedResponseText(response, signal);
  signal.throwIfAborted();
  return parseDuckDuckGoLiteResults(html);
}

async function readBoundedResponseText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_LENGTH) {
    throw new Error("DuckDuckGo Lite response exceeded the size limit.");
  }
  if (response.body === null) return "";

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body.getReader();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_LENGTH) {
        await reader.cancel();
        throw new Error("DuckDuckGo Lite response exceeded the size limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function liteSafeSearchValue(value: "strict" | "moderate" | "off"): string {
  switch (value) {
    case "strict":
      return "1";
    case "off":
      return "-2";
    case "moderate":
      return "-1";
  }
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlTextNode = DefaultTreeAdapterTypes.TextNode;

function parseDuckDuckGoLiteResults(html: string): WebSearchResult[] {
  const document = parse(html);
  return findElements(document, (element) => hasClass(element, "result-link"))
    .map((anchor) => {
      const rawUrl = attribute(anchor, "href");
      const url = rawUrl === undefined ? null : resolveSearchResultUrl(rawUrl);
      if (url === null) return null;
      const row = closestRow(anchor);
      const description = row === null ? "" : findFollowingSnippet(row);
      return {
        description,
        hostname: resultHostname(url, ""),
        title: normalizeText(textContent(anchor)),
        url,
      } satisfies WebSearchResult;
    })
    .filter((result): result is WebSearchResult => result !== null);
}

function findElements(node: HtmlNode, predicate: (element: HtmlElement) => boolean): HtmlElement[] {
  const matches: HtmlElement[] = [];
  const visit = (current: HtmlNode): void => {
    if (isElement(current)) {
      if (predicate(current)) matches.push(current);
      for (const child of current.childNodes) visit(child);
      return;
    }
    if ("childNodes" in current) {
      for (const child of current.childNodes) visit(child);
    }
  };
  visit(node);
  return matches;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function isTextNode(node: HtmlNode): node is HtmlTextNode {
  return node.nodeName === "#text" && "value" in node;
}

function hasClass(element: HtmlElement, className: string): boolean {
  return (attribute(element, "class") ?? "").split(/\s+/u).includes(className);
}

function attribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function textContent(node: HtmlNode): string {
  if (isTextNode(node)) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map((child) => textContent(child)).join("");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function closestRow(element: HtmlElement): HtmlElement | null {
  let current = element.parentNode;
  while (current !== null) {
    if (isElement(current) && current.tagName === "tr") return current;
    current = "parentNode" in current ? current.parentNode : null;
  }
  return null;
}

function findFollowingSnippet(row: HtmlElement): string {
  const parent = row.parentNode;
  if (parent === null) return "";
  const rowIndex = parent.childNodes.indexOf(row);
  if (rowIndex < 0) return "";
  for (const sibling of parent.childNodes.slice(rowIndex + 1)) {
    if (!isElement(sibling) || sibling.tagName !== "tr") continue;
    const snippet = findElements(sibling, (element) => hasClass(element, "result-snippet"))[0];
    if (snippet !== undefined) return normalizeText(textContent(snippet));
    if (findElements(sibling, (element) => hasClass(element, "result-link")).length > 0) break;
  }
  return "";
}

function resolveSearchResultUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const redirected = url.pathname === "/l/" ? url.searchParams.get("uddg") : null;
    const resolved = redirected === null ? url : new URL(redirected);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

export class WebSearchTool {
  public constructor(private readonly provider: WebSearchProvider = defaultWebSearchProvider) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [{
      description:
        "Search the public web with the built-in free DuckDuckGo provider. Use this for current information that is not in the conversation or an attached workspace. Results are bounded excerpts with source URLs; opening or interacting with a page is not supported by this tool.",
      name: "web_search",
      parameters: modelToolParameters(webSearchArgumentsSchema),
    }];
  }

  public getExecutionPolicy(): ToolExecutionPolicy {
    return { group: "read", kind: "parallel" };
  }

  public async execute(rawArguments: string, signal: AbortSignal): Promise<ToolExecution> {
    try {
      const input = webSearchArgumentsSchema.parse(parseToolArguments(rawArguments));
      const results = await this.provider(
        input.query,
        {
          region: input.region,
          safeSearch: input.safeSearch,
        },
        signal,
      );
      const boundedResults = results.slice(0, input.maxResults).map((result) => ({
        description: result.description.slice(0, MAX_RESULT_DESCRIPTION_LENGTH),
        hostname: result.hostname.slice(0, 200),
        title: result.title.slice(0, MAX_RESULT_TITLE_LENGTH),
        url: result.url.slice(0, 2_000),
      }));
      const execution: ToolExecutionResult = {
        content: JSON.stringify({
          ok: true,
          value: {
            maxResults: input.maxResults,
            query: input.query,
            region: input.region,
            results: boundedResults,
            safeSearch: input.safeSearch,
          },
        }),
        isError: false,
        kind: "completed",
      };
      return execution;
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        content: toolErrorContent(error, "tool:web_search"),
        isError: true,
        kind: "completed",
      };
    }
  }
}
