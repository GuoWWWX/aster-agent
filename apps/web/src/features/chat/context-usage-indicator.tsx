import { type ConversationContextUsage } from "@agent/protocol";
import type { CSSProperties, ReactElement } from "react";

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
