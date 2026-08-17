import {
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  estimateContextTokens,
  type ConversationContextUsage,
} from "@agent/protocol";
import type { CSSProperties, ReactElement } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import "./context-usage-indicator.css";

type ContextPressure = "normal" | "warning" | "critical" | "unknown";

type ContextUsageIndicatorProps = {
  composerValue: string;
  contextWindowTokens: number;
  modelName: string | null;
  usage: ConversationContextUsage | null;
};

export function ContextUsageIndicator({
  composerValue,
  contextWindowTokens,
  modelName,
  usage,
}: ContextUsageIndicatorProps): ReactElement {
  const pendingInputTokens = estimatePendingInputTokens(composerValue);
  const estimatedInputTokens = (usage?.estimatedInputTokens ?? 0) + pendingInputTokens;
  const outputReserveTokens = usage?.outputReserveTokens ?? 0;
  const occupiedTokens = estimatedInputTokens + outputReserveTokens;
  const compressionThresholdTokens = usage?.compressionThresholdTokens ?? 0;
  const percentage = contextWindowTokens > 0
    ? Math.min(100, Math.round((occupiedTokens / contextWindowTokens) * 100))
    : 0;
  const pressure = usage === null
    ? "unknown"
    : getContextPressure(compressionThresholdTokens, occupiedTokens);
  const availableTokens = Math.max(contextWindowTokens - occupiedTokens, 0);
  const buttonLabel = contextButtonLabel({
    contextWindowTokens,
    compressionThresholdTokens,
    occupiedTokens,
    percentage,
    pressure,
    usage,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={buttonLabel}
          className="context-usage-indicator__trigger"
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
          <dl className="context-usage-indicator__details">
            <UsageRow label="输入上下文（估算）" value={formatTokenCount(estimatedInputTokens)} />
            {pendingInputTokens > 0 ? (
              <UsageRow label="当前输入" value={formatTokenCount(pendingInputTokens)} />
            ) : null}
            <UsageRow label="回复预留" value={formatTokenCount(outputReserveTokens)} />
            <UsageRow
              label="模型窗口"
              value={contextWindowTokens > 0 ? formatTokenCount(contextWindowTokens) : "未配置"}
            />
            {contextWindowTokens > 0 ? (
              <UsageRow label="剩余可用" value={formatTokenCount(availableTokens)} />
            ) : null}
            <UsageRow
              label="自动压缩阈值"
              value={compressionThresholdLabel(usage)}
            />
            <UsageRow label="系统指令" value={formatTokenCount(usage.estimatedSystemTokens)} />
            <UsageRow label="会话历史" value={formatTokenCount(usage.estimatedConversationTokens)} />
            {usage.estimatedAttachmentTokens > 0 ? (
              <UsageRow label="文件与图片" value={formatTokenCount(usage.estimatedAttachmentTokens)} />
            ) : null}
            {usage.estimatedReferenceTokens > 0 ? (
              <UsageRow label="引用对话" value={formatTokenCount(usage.estimatedReferenceTokens)} />
            ) : null}
            {usage.estimatedToolTokens > 0 ? (
              <UsageRow label="工具结果与调用" value={formatTokenCount(usage.estimatedToolTokens)} />
            ) : null}
            {usage.estimatedToolDefinitionTokens > 0 ? (
              <UsageRow label="工具定义" value={formatTokenCount(usage.estimatedToolDefinitionTokens)} />
            ) : null}
          </dl>
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

function UsageRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function estimatePendingInputTokens(content: string): number {
  const trimmed = content.trim();
  return trimmed.length === 0
    ? 0
    : estimateContextTokens(trimmed) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
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
  occupiedTokens,
  percentage,
  pressure,
  usage,
}: {
  contextWindowTokens: number;
  compressionThresholdTokens: number;
  occupiedTokens: number;
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
  const windowLabel = contextWindowTokens > 0
    ? `${formatTokenCount(occupiedTokens)} / ${formatTokenCount(contextWindowTokens)}（${percentage}%）`
    : formatTokenCount(occupiedTokens);
  return `${status}：${windowLabel}，阈值 ${formatTokenCount(compressionThresholdTokens)}，点击查看明细`;
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

function compressionThresholdLabel(usage: ConversationContextUsage): string {
  const mode = usage.compressionMode === "percentage" ? "百分比" : "Token";
  return `${mode} · ${formatTokenCount(usage.compressionThresholdTokens)}`;
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
