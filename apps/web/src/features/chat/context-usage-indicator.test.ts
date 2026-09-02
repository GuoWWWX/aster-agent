// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ConversationContextUsage } from "@agent/protocol";

import {
  getContextUsageRows,
  ProviderCacheStatus,
  providerCacheInlineMetrics,
  providerCacheLabel,
} from "./context-usage-indicator.js";

function usage(overrides: Partial<ConversationContextUsage> = {}): ConversationContextUsage {
  return {
    compressionMode: "percentage",
    compressionThresholdTokens: 80_000,
    estimatedAttachmentTokens: 0,
    estimatedConversationTokens: 1_400,
    estimatedInputTokens: 4_100,
    estimatedReferenceTokens: 0,
    estimatedSkillCatalogTokens: 200,
    estimatedSystemTokens: 2_000,
    estimatedTaskListTokens: 100,
    estimatedToolDefinitionTokens: 500,
    estimatedToolTokens: 200,
    historyCharacters: 4_800,
    includedMessageCount: 6,
    omittedMessageCount: 4,
    outputReserveTokens: 8_192,
    skillReserveTokens: 300,
    ...overrides,
  };
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("getContextUsageRows", () => {
  it("groups context usage with indentation-only hierarchy", () => {
    const rows = getContextUsageRows(usage());

    expect(rows).toMatchObject([
      { label: "系统上下文", level: 0, tokens: 2_200 },
      { label: "基础系统提示词", level: 1, tokens: 1_400 },
      { label: "内置工具", level: 1, tokens: 500 },
      { label: "MCP 工具", level: 1, tokens: 0 },
      { label: "Skill 目录", level: 1, tokens: 200 },
      { label: "当前任务清单", level: 1, tokens: 100 },
      { label: "当前有效会话", level: 0, tokens: 1_600 },
      { label: "对话文本与压缩摘要", level: 1, tokens: 1_400 },
      { label: "工具调用与结果", level: 1, tokens: 200 },
      { label: "文件、图片与引用", level: 1, tokens: 0 },
      { label: "预留容量", level: 0, tokens: 8_492 },
      { label: "模型回复", level: 1, tokens: 8_192 },
      { label: "Skill 加载", level: 1, tokens: 300 },
    ]);
  });

  it("combines selected files, images, and references in the conversation detail", () => {
    const rows = getContextUsageRows(usage({
      estimatedAttachmentTokens: 140,
      estimatedReferenceTokens: 360,
    }));

    expect(rows.find((row) => row.label === "文件、图片与引用"))
      .toMatchObject({ level: 1, tokens: 500 });
  });
});

describe("providerCacheLabel", () => {
  it("shows the latest provider-reported cache hit rate", () => {
    expect(providerCacheLabel(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 650,
          hitRate: 0.65,
          inputTokens: 1_000,
          reportedRequestCount: 2,
          requestCount: 2,
        },
        latest: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 800,
          hitRate: 0.8,
          inputTokens: 1_000,
          outputTokens: 120,
          trendDelta: 0.2,
        },
      },
    }))).toBe("缓存 80%");
  });

  it("distinguishes missing cache details from a zero-percent hit", () => {
    expect(providerCacheLabel(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 0,
          hitRate: null,
          inputTokens: 0,
          reportedRequestCount: 0,
          requestCount: 1,
        },
        latest: {
          cacheCreationInputTokens: null,
          cachedInputTokens: null,
          hitRate: null,
          inputTokens: 100,
          outputTokens: 20,
          trendDelta: null,
        },
      },
    }))).toBe("缓存未上报");
    expect(providerCacheLabel(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 0,
          hitRate: 0,
          inputTokens: 100,
          reportedRequestCount: 1,
          requestCount: 1,
        },
        latest: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 0,
          hitRate: 0,
          inputTokens: 100,
          outputTokens: 20,
          trendDelta: 0,
        },
      },
    }))).toBe("缓存 0%");
  });
});

describe("providerCacheInlineMetrics", () => {
  it("shows the latest input, output, cache rate, and weighted average with status tones", () => {
    expect(providerCacheInlineMetrics(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 1_300,
          hitRate: 0.65,
          inputTokens: 2_000,
          reportedRequestCount: 2,
          requestCount: 2,
        },
        latest: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 800,
          hitRate: 0.8,
          inputTokens: 1_000,
          outputTokens: 120,
          trendDelta: 0.2,
        },
      },
    }))).toEqual([
      { kind: "input", label: "本次发送", shortLabel: "发送", tone: "success", value: "1.0K" },
      { kind: "output", label: "模型返回", shortLabel: "返回", tone: "danger", value: "120" },
      { kind: "cache", label: "本次命中率", shortLabel: "命中", tone: "good", value: "80%" },
      { kind: "cache", label: "平均命中率", shortLabel: "平均", tone: "warning", value: "65%" },
    ]);
  });

  it("renders a compact cache summary centered below the composer", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(ProviderCacheStatus, {
        usage: usage({
          providerCache: {
            cumulative: {
              cacheCreationInputTokens: 0,
              cachedInputTokens: 1_700,
              hitRate: 0.85,
              inputTokens: 2_000,
              reportedRequestCount: 2,
              requestCount: 2,
            },
            latest: {
              cacheCreationInputTokens: 0,
              cachedInputTokens: 960,
              hitRate: 0.96,
              inputTokens: 1_000,
              outputTokens: 120,
              trendDelta: 0.2,
            },
          },
        }),
      }));
    });

    const trigger = container.querySelector("button");
    expect(trigger?.className).toContain("flex");
    expect(trigger?.className).not.toContain("inline-flex");
    expect(trigger?.className).toContain("mx-auto");
    expect(trigger?.className).toContain("justify-center");
    expect(trigger?.className).toContain("whitespace-nowrap");
    expect(trigger?.className).toContain("text-[length:var(--app-font-size-caption)]");
    expect(trigger?.className).not.toContain("bg-[var(--app-status-success-bg)]");
    expect(trigger?.getAttribute("aria-label")).toContain("本次发送 1.0K");
    expect(trigger?.getAttribute("title")).toBe(trigger?.getAttribute("aria-label"));
    expect(trigger?.querySelector('[data-label-variant="full"]')?.textContent).toBe("本次发送");
    expect(trigger?.querySelector('[data-label-variant="short"]')?.textContent).toBe("发送");
    expect(trigger?.querySelectorAll('[data-label-variant="full"]')).toHaveLength(4);
    expect(trigger?.querySelectorAll('[data-label-variant="short"]')).toHaveLength(4);
    expect(trigger?.textContent).toContain("1.0K");
    expect(trigger?.textContent).toContain("120");
    expect(trigger?.textContent).toContain("96%");
    expect(trigger?.textContent).toContain("85%");
    expect(trigger?.textContent).not.toContain("pp");
    expect(trigger?.querySelector('[data-token-direction="up"][data-tone="success"]')).not.toBeNull();
    expect(trigger?.querySelector('[data-token-direction="down"][data-tone="danger"]')).not.toBeNull();
    expect(trigger?.querySelector('[data-cache-metric="本次命中率"][data-tone="success"]')).not.toBeNull();
    expect(trigger?.querySelector('[data-cache-metric="平均命中率"][data-tone="good"]')).not.toBeNull();
    expect(trigger?.querySelector('[data-cache-metric]')?.className).not.toContain("bg-");
    expect(trigger?.querySelector('[data-cache-metric]')?.className).not.toContain("rounded-");
    expect(trigger?.querySelector('[data-cache-metric]')?.className).not.toContain("ring-");
    expect(trigger?.querySelector('[data-cache-indicator]')).toBeNull();
  });

  it("keeps directional arrow colors while unavailable values stay neutral", () => {
    expect(providerCacheInlineMetrics(null)).toEqual([
      { kind: "input", label: "本次发送", shortLabel: "发送", tone: "success", value: "--" },
      { kind: "output", label: "模型返回", shortLabel: "返回", tone: "danger", value: "--" },
      { kind: "cache", label: "本次命中率", shortLabel: "命中", tone: "neutral", value: "--" },
      { kind: "cache", label: "平均命中率", shortLabel: "平均", tone: "neutral", value: "--" },
    ]);
  });

  it("uses a danger tone for a low cache rate without confusing zero with missing data", () => {
    expect(providerCacheInlineMetrics(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 0,
          hitRate: 0,
          inputTokens: 2_000,
          reportedRequestCount: 2,
          requestCount: 2,
        },
        latest: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: 790,
          hitRate: 0.79,
          inputTokens: 1_000,
          outputTokens: 120,
          trendDelta: -0.15,
        },
      },
    }))).toEqual([
      { kind: "input", label: "本次发送", shortLabel: "发送", tone: "success", value: "1.0K" },
      { kind: "output", label: "模型返回", shortLabel: "返回", tone: "danger", value: "120" },
      { kind: "cache", label: "本次命中率", shortLabel: "命中", tone: "caution", value: "79%" },
      { kind: "cache", label: "平均命中率", shortLabel: "平均", tone: "danger", value: "0%" },
    ]);
  });

  it("uses gradual cache colors at the 90, 80, 70, and 60 percent boundaries", () => {
    const cacheToneAt = (hitRate: number | null) => providerCacheInlineMetrics(usage({
      providerCache: {
        cumulative: {
          cacheCreationInputTokens: 0,
          cachedInputTokens: hitRate === null ? 0 : Math.round(hitRate * 1_000),
          hitRate,
          inputTokens: hitRate === null ? 0 : 1_000,
          reportedRequestCount: hitRate === null ? 0 : 1,
          requestCount: 1,
        },
        latest: {
          cacheCreationInputTokens: hitRate === null ? null : 0,
          cachedInputTokens: hitRate === null ? null : Math.round(hitRate * 1_000),
          hitRate,
          inputTokens: 1_000,
          outputTokens: 120,
          trendDelta: null,
        },
      },
    }))[2]?.tone;

    expect(cacheToneAt(0.9)).toBe("success");
    expect(cacheToneAt(0.8)).toBe("good");
    expect(cacheToneAt(0.7)).toBe("caution");
    expect(cacheToneAt(0.6)).toBe("warning");
    expect(cacheToneAt(0.59)).toBe("danger");
    expect(cacheToneAt(null)).toBe("neutral");
  });
});
