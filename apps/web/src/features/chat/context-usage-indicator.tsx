import { type ConversationContextUsage } from "@agent/protocol";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Fragment, type CSSProperties, type ReactElement } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import "./context-usage-indicator.css";

type ContextPressure = "normal" | "warning" | "critical" | "unknown";

type ContextUsageIndicatorProps = {
  contextWindowTokens: number;
  modelName: string | null;
  usage: ConversationContextUsage | null;
};

type ContextUsageRow = {
  level: 0 | 1;
  label: string;
  tokens: number;
};

type ProviderCacheInlineMetric = {
  kind: "cache" | "input" | "output";
  label: string;
  shortLabel: string;
  tone: "caution" | "danger" | "good" | "neutral" | "success" | "warning";
  value: string;
};

export function ContextUsageIndicator({
  contextWindowTokens,
  modelName,
  usage,
}: ContextUsageIndicatorProps): ReactElement {
  const skillReserveTokens = usage?.skillReserveTokens ?? 0;
  const usedInputTokens = Math.max((usage?.estimatedInputTokens ?? 0) - skillReserveTokens, 0);
  const outputReserveTokens = usage?.outputReserveTokens ?? 0;
  const reservedTokens = skillReserveTokens + outputReserveTokens;
  const budgetedTokens = usedInputTokens + reservedTokens;
  const compressionThresholdTokens = usage?.compressionThresholdTokens ?? 0;
  const capacityTokens = contextWindowTokens > 0
    ? contextWindowTokens
    : compressionThresholdTokens;
  const compressionLimitTokens = compressionThresholdTokens > 0
    ? compressionThresholdTokens
    : capacityTokens;
  const percentage = capacityTokens > 0
    ? Math.min(100, Math.round((usedInputTokens / capacityTokens) * 100))
    : 0;
  const pressure = usage === null
    ? "unknown"
    : getContextPressure(compressionThresholdTokens, budgetedTokens);
  const remainingBeforeCompressionTokens = Math.max(compressionLimitTokens - budgetedTokens, 0);
  const rows = usage === null
    ? []
    : getContextUsageRows(usage);
  const buttonLabel = contextButtonLabel({
    contextWindowTokens,
    compressionThresholdTokens,
    usedInputTokens,
    percentage,
    pressure,
    usage,
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={buttonLabel}
          className="context-usage-indicator__trigger inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--app-radius)] text-emerald-600 outline-none transition-colors hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
          data-pressure={pressure}
          title={buttonLabel}
          type="button"
        >
          <span
            aria-hidden="true"
            className="context-usage-indicator__ring"
            style={{ "--context-usage-progress": `${percentage}%` } as CSSProperties}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="context-usage-indicator__content"
      >
        <header className="context-usage-indicator__header">
          <div>
            <p>上下文</p>
            <strong>{modelName ?? "未配置模型"}</strong>
          </div>
          <span data-pressure={pressure}>
            {contextWindowTokens > 0 ? `${percentage}%` : "--"}
          </span>
        </header>

        <div className="context-usage-indicator__meter" data-pressure={pressure}>
          <span style={{ width: `${percentage}%` }} />
        </div>

        {usage === null ? (
          <p className="context-usage-indicator__loading">正在统计上下文…</p>
        ) : (
          <>
            <section className="context-usage-indicator__budget" aria-label="当前上下文预算">
              <div>
                <p>{capacityTokens > 0 ? "已使用 / 总容量" : "已使用"}</p>
                <strong>
                  {capacityTokens > 0
                    ? `${formatTokenCount(usedInputTokens)} / ${formatTokenCount(capacityTokens)}`
                    : formatTokenCount(usedInputTokens)}
                </strong>
              </div>
              {compressionLimitTokens > 0 ? (
                <div>
                  <p>{compressionThresholdTokens > 0 ? "距自动压缩" : "可用余量"}</p>
                  <strong>{formatTokenCount(remainingBeforeCompressionTokens)}</strong>
                </div>
              ) : null}
            </section>

            <p className="context-usage-indicator__estimate-note">
              Token 为本地估算，模型服务端的实际计量可能略有差异。
            </p>

            <section className="context-usage-indicator__section">
              <dl className="context-usage-indicator__details">
                {rows.map((row) => (
                  <UsageRow
                    key={row.label}
                    label={row.label}
                    level={row.level}
                    value={formatTokenCount(row.tokens)}
                  />
                ))}
              </dl>
            </section>
          </>
        )}

        <p className="context-usage-indicator__status" data-pressure={pressure}>
          {contextStatusMessage(pressure, contextWindowTokens, usage?.omittedMessageCount ?? 0)}
        </p>
        {usage !== null && usage.omittedMessageCount > 0 ? (
          <p className="context-usage-indicator__truncation">
            运行时已忽略最早的 {usage.omittedMessageCount} 条历史消息。
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function ProviderCacheStatus({
  usage,
}: {
  usage: ConversationContextUsage | null;
}): ReactElement {
  const metrics = providerCacheInlineMetrics(usage);
  const accessibleLabel = `${metrics.map((metric) => (
    `${metric.label} ${metric.value}`
  )).join("，")}，点击查看明细`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={accessibleLabel}
          className="pointer-events-auto mx-auto -mb-2 flex min-h-4 w-fit max-w-[calc(100%_-_32px)] items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[var(--app-radius)] px-1 py-0.5 text-[length:var(--app-font-size-caption)] tabular-nums text-[var(--app-muted-foreground)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-focus-ring)]"
          title={accessibleLabel}
          type="button"
        >
          {metrics.map((metric, index) => (
            <Fragment key={metric.label}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-[var(--app-border)]">·</span>
              ) : null}
              {metric.kind === "cache" ? (
                <span
                  className="inline-flex min-w-0 items-center gap-1"
                  data-cache-metric={metric.label}
                  data-tone={metric.tone}
                >
                  <ProviderMetricLabel metric={metric} />
                  <strong className={`font-semibold ${providerCacheToneTextClassName(metric.tone)}`}>
                    {metric.value}
                  </strong>
                </span>
              ) : (
                <span
                  className="inline-flex min-w-0 items-center gap-1"
                  data-token-direction={metric.kind === "input" ? "up" : "down"}
                  data-tone={metric.tone}
                >
                  {metric.kind === "input" ? (
                    <ArrowUp
                      aria-hidden="true"
                      className={providerCacheToneTextClassName(metric.tone)}
                      size={12}
                      strokeWidth={2.25}
                    />
                  ) : (
                    <ArrowDown
                      aria-hidden="true"
                      className={providerCacheToneTextClassName(metric.tone)}
                      size={12}
                      strokeWidth={2.25}
                    />
                  )}
                  <ProviderMetricLabel metric={metric} />
                  <span
                    className="font-semibold text-[var(--app-foreground)]"
                  >
                    {metric.value}
                  </span>
                </span>
              )}
            </Fragment>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="context-usage-indicator__content">
        {usage === null ? (
          <p className="context-usage-indicator__loading">正在读取 Provider 缓存计量…</p>
        ) : (
          <ProviderCacheDetails usage={usage} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ProviderMetricLabel({
  metric,
}: {
  metric: ProviderCacheInlineMetric;
}): ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className="provider-cache-status__label--full"
        data-label-variant="full"
      >
        {metric.label}
      </span>
      <span
        aria-hidden="true"
        className="provider-cache-status__label--short"
        data-label-variant="short"
      >
        {metric.shortLabel}
      </span>
    </>
  );
}

function ProviderCacheDetails({
  usage,
}: {
  usage: ConversationContextUsage;
}): ReactElement {
  const cache = usage.providerCache;
  const latest = cache?.latest ?? null;
  const cumulative = cache?.cumulative;
  const latestCacheLabel = latest?.hitRate === null || latest === null
    ? "未上报"
    : formatCachePercentage(latest.hitRate);
  const cumulativeCacheLabel = cumulative?.hitRate === null || cumulative === undefined
    ? "未上报"
    : formatCachePercentage(cumulative.hitRate);

  return (
    <section
      aria-label="模型 Token 与缓存计量"
      className="mb-2.5 rounded-[var(--app-radius-small)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 py-1.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-[length:var(--app-font-size-auxiliary)] font-semibold text-[var(--app-muted-foreground)]">
          Token 与缓存（服务端实际）
        </p>
        <strong className="shrink-0 text-[length:var(--app-font-size-subtitle)] tabular-nums text-emerald-600 dark:text-emerald-400">
          {latest === null ? "暂无数据" : `最近一次 ${latestCacheLabel}`}
        </strong>
      </div>
      {latest === null ? (
        <p className="mb-0 mt-1 text-[length:var(--app-font-size-auxiliary)] leading-5 text-[var(--app-muted-foreground)]">
          完成一次模型请求后显示真实缓存命中情况。
        </p>
      ) : (
        <dl className="mb-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--app-font-size-auxiliary)] leading-5">
          <dt className="text-[var(--app-muted-foreground)]">最近输入</dt>
          <dd className="m-0 text-right tabular-nums text-[var(--app-foreground)]">
            {formatTokenCount(latest.inputTokens)}
          </dd>
          <dt className="text-[var(--app-muted-foreground)]">最近输出</dt>
          <dd className="m-0 text-right tabular-nums text-[var(--app-foreground)]">
            {formatTokenCount(latest.outputTokens)}
          </dd>
          <dt className="text-[var(--app-muted-foreground)]">最近缓存命中</dt>
          <dd className="m-0 text-right tabular-nums text-[var(--app-foreground)]">
            {latest.cachedInputTokens === null
              ? "Provider 未上报"
              : formatTokenCount(latest.cachedInputTokens)}
          </dd>
          <dt className="text-[var(--app-muted-foreground)]">最近命中率</dt>
          <dd className="m-0 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {latestCacheLabel}
          </dd>
          <dt className="text-[var(--app-muted-foreground)]">累计命中率</dt>
          <dd className="m-0 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {cumulativeCacheLabel}
          </dd>
          <dt className="text-[var(--app-muted-foreground)]">有效响应</dt>
          <dd className="m-0 text-right tabular-nums text-[var(--app-foreground)]">
            {cumulative?.reportedRequestCount ?? 0} / {cumulative?.requestCount ?? 0} 次包含缓存明细
          </dd>
          {(latest.cacheCreationInputTokens ?? 0) > 0
            || (cumulative?.cacheCreationInputTokens ?? 0) > 0 ? (
              <>
                <dt className="text-[var(--app-muted-foreground)]">缓存写入</dt>
                <dd className="m-0 text-right tabular-nums text-[var(--app-foreground)]">
                  最近 {formatTokenCount(latest.cacheCreationInputTokens ?? 0)} · 累计 {formatTokenCount(cumulative?.cacheCreationInputTokens ?? 0)}
                </dd>
              </>
            ) : null}
        </dl>
      )}
      {latest !== null ? (
        <p className="mb-0 mt-1.5 border-t border-[var(--app-border)] pt-1.5 text-[length:var(--app-font-size-caption)] leading-4 text-[var(--app-muted-foreground)]">
          失败请求不计入；累计命中率按当前模型成功响应中已上报的输入 Token 加权计算。
        </p>
      ) : null}
    </section>
  );
}

function UsageRow({
  label,
  level,
  value,
}: {
  label: string;
  level: 0 | 1;
  value: string;
}): ReactElement {
  return (
    <div data-level={level}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function getContextUsageRows(
  usage: ConversationContextUsage,
): ContextUsageRow[] {
  const systemMessageTokens = Math.max(
    usage.estimatedSystemTokens - usage.skillReserveTokens - usage.estimatedTaskListTokens,
    0,
  );
  const baseSystemTokens = Math.max(
    systemMessageTokens - usage.estimatedSkillCatalogTokens,
    0,
  );
  const systemContextTokens = systemMessageTokens
    + usage.estimatedTaskListTokens
    + usage.estimatedToolDefinitionTokens;
  const currentConversationTokens = usage.estimatedConversationTokens
    + usage.estimatedToolTokens
    + usage.estimatedAttachmentTokens
    + usage.estimatedReferenceTokens;
  const reserveTokens = usage.outputReserveTokens + usage.skillReserveTokens;

  return [
    {
      label: "系统上下文",
      level: 0,
      tokens: systemContextTokens,
    },
    {
      label: "基础系统提示词",
      level: 1,
      tokens: baseSystemTokens,
    },
    {
      label: "内置工具",
      level: 1,
      tokens: usage.estimatedToolDefinitionTokens,
    },
    {
      label: "MCP 工具",
      level: 1,
      tokens: 0,
    },
    {
      label: "Skill 目录",
      level: 1,
      tokens: usage.estimatedSkillCatalogTokens,
    },
    {
      label: "当前任务清单",
      level: 1,
      tokens: usage.estimatedTaskListTokens,
    },
    {
      label: "当前有效会话",
      level: 0,
      tokens: currentConversationTokens,
    },
    {
      label: "对话文本与压缩摘要",
      level: 1,
      tokens: usage.estimatedConversationTokens,
    },
    {
      label: "工具调用与结果",
      level: 1,
      tokens: usage.estimatedToolTokens,
    },
    {
      label: "文件、图片与引用",
      level: 1,
      tokens: usage.estimatedAttachmentTokens + usage.estimatedReferenceTokens,
    },
    {
      label: "预留容量",
      level: 0,
      tokens: reserveTokens,
    },
    {
      label: "模型回复",
      level: 1,
      tokens: usage.outputReserveTokens,
    },
    {
      label: "Skill 加载",
      level: 1,
      tokens: usage.skillReserveTokens,
    },
  ];
}

export function providerCacheLabel(
  usage: ConversationContextUsage | null,
): string {
  if (usage === null || usage.providerCache?.latest === null || usage.providerCache === undefined) {
    return "缓存 --";
  }
  const hitRate = usage.providerCache.latest.hitRate;
  return hitRate === null
    ? "缓存未上报"
    : `缓存 ${formatCachePercentage(hitRate)}`;
}

export function providerCacheInlineMetrics(
  usage: ConversationContextUsage | null,
): ProviderCacheInlineMetric[] {
  const latest = usage?.providerCache?.latest ?? null;
  const cumulative = usage?.providerCache?.cumulative;
  return [
    {
      kind: "input",
      label: "本次发送",
      shortLabel: "发送",
      tone: "success",
      value: latest === null ? "--" : formatCompactTokenCount(latest.inputTokens),
    },
    {
      kind: "output",
      label: "模型返回",
      shortLabel: "返回",
      tone: "danger",
      value: latest === null ? "--" : formatCompactTokenCount(latest.outputTokens),
    },
    {
      kind: "cache",
      label: "本次命中率",
      shortLabel: "命中",
      tone: providerCacheTone(latest?.hitRate),
      value: latest?.hitRate === null || latest === null
        ? "--"
        : formatCachePercentage(latest.hitRate),
    },
    {
      kind: "cache",
      label: "平均命中率",
      shortLabel: "平均",
      tone: providerCacheTone(cumulative?.hitRate),
      value: cumulative?.hitRate === null || cumulative === undefined
        ? "--"
        : formatCachePercentage(cumulative.hitRate),
    },
  ];
}

function providerCacheTone(
  hitRate: number | null | undefined,
): ProviderCacheInlineMetric["tone"] {
  if (hitRate === null || hitRate === undefined) return "neutral";
  if (hitRate >= 0.9) return "success";
  if (hitRate >= 0.8) return "good";
  if (hitRate >= 0.7) return "caution";
  if (hitRate >= 0.6) return "warning";
  return "danger";
}

function providerCacheToneTextClassName(
  tone: ProviderCacheInlineMetric["tone"],
): string {
  if (tone === "success") return "text-[var(--app-status-success-fg)]";
  if (tone === "good") return "text-green-500 dark:text-green-300";
  if (tone === "caution") return "text-amber-500 dark:text-amber-300";
  if (tone === "warning") return "text-orange-600 dark:text-orange-400";
  if (tone === "danger") return "text-[var(--app-status-danger-fg)]";
  return "text-[var(--app-status-neutral-fg)]";
}

function formatCachePercentage(value: number): string {
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
}

function formatCompactTokenCount(value: number): string {
  if (value < 1_000) return `${value}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value / 1_000)}K`;
}

function getContextPressure(
  compressionThresholdTokens: number,
  occupiedTokens: number,
): ContextPressure {
  if (compressionThresholdTokens <= 0) {
    return "unknown";
  }

  if (occupiedTokens >= compressionThresholdTokens) {
    return "critical";
  }
  if (occupiedTokens >= compressionThresholdTokens * 0.75) {
    return "warning";
  }
  return "normal";
}

function contextButtonLabel({
  contextWindowTokens,
  compressionThresholdTokens,
  usedInputTokens,
  percentage,
  pressure,
  usage,
}: {
  contextWindowTokens: number;
  compressionThresholdTokens: number;
  usedInputTokens: number;
  percentage: number;
  pressure: ContextPressure;
  usage: ConversationContextUsage | null;
}): string {
  if (usage === null) {
    return "正在统计上下文使用情况";
  }
  const status = pressure === "critical"
    ? "即将自动压缩"
    : pressure === "warning"
      ? "接近压缩阈值"
      : "上下文充足";
  const capacityTokens = contextWindowTokens > 0
    ? contextWindowTokens
    : compressionThresholdTokens;
  const windowLabel = capacityTokens > 0
    ? `${formatTokenCount(usedInputTokens)} / ${formatTokenCount(capacityTokens)}（${percentage}%）`
    : formatTokenCount(usedInputTokens);
  return `${status}：已使用 ${windowLabel}，点击查看明细`;
}

function contextStatusMessage(
  pressure: ContextPressure,
  contextWindowTokens: number,
  omittedMessageCount: number,
): string {
  if (pressure === "unknown") {
    return "正在统计上下文使用情况。";
  }
  if (contextWindowTokens <= 0) {
    return "当前模型未配置上下文窗口，自动压缩按 Token 阈值计算。";
  }
  if (pressure === "critical") {
    return "已达到自动压缩阈值，发送下一条消息时会裁剪最早的历史。";
  }
  if (pressure === "warning") {
    return "上下文接近压缩阈值。";
  }
  if (omittedMessageCount > 0) {
    return "上下文充足；较早历史已不再纳入本轮请求。";
  }
  return "上下文充足。";
}

function formatTokenCount(value: number): string {
  if (value < 1_000) {
    return `${value} tokens`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1)}K tokens`;
  }
  return `${Math.round(value / 1_000)}K tokens`;
}
