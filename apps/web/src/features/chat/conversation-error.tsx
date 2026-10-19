import { redactErrorIdentifiers } from "@agent/protocol";
import { ChevronRight, CircleAlert } from "lucide-react";
import type { ReactElement } from "react";

export function ConversationErrorItem({ content }: { content: string }): ReactElement {
  return <ConversationErrorQuote content={content} scope="operation" />;
}

export function ConversationErrorContent({ content }: { content: string }): ReactElement {
  return <ConversationErrorQuote content={content} scope="model" />;
}

export function stripLegacyErrorInstanceId(content: string): string {
  return redactErrorIdentifiers(content.replace(
    /\s*[（(]错误编号：[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[）)]/giu,
    "",
  )).trim();
}

type ConversationErrorScope = "model" | "operation" | "tool";
type ConversationErrorCategory =
  | "authentication"
  | "internal"
  | "limit"
  | "network"
  | "provider"
  | "quota"
  | "response"
  | "timeout"
  | "tool"
  | "unknown";

export type ConversationErrorPresentation = {
  category: ConversationErrorCategory;
  detail: string;
  message: string;
  summary: string;
  technicalDetail: string | null;
  title: string;
};

function splitConversationErrorDetail(detail: string): {
  message: string;
  technicalDetail: string | null;
} {
  const marker = /(?:接口错误|网络错误详情|内部错误详情)：/u.exec(detail);
  if (marker?.index === undefined) {
    return { message: detail, technicalDetail: null };
  }
  return {
    message: detail.slice(0, marker.index).trim(),
    technicalDetail: detail.slice(marker.index).trim() || null,
  };
}

export function describeConversationError(
  content: string,
  scope: ConversationErrorScope = "model",
): ConversationErrorPresentation {
  const detail = stripLegacyErrorInstanceId(content);
  const normalized = detail.toLowerCase();
  const separated = splitConversationErrorDetail(detail);
  if (scope === "tool") {
    return {
      category: "tool",
      detail: detail || "工具调用没有返回可显示的错误详情。",
      message: detail || "工具调用没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "工具执行未完成"),
      technicalDetail: null,
      title: "工具调用失败",
    };
  }
  if (scope === "operation") {
    return {
      category: "internal",
      detail: detail || "操作没有返回可显示的错误详情。",
      message: detail || "操作没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "操作未完成"),
      technicalDetail: null,
      title: "操作失败",
    };
  }

  if (/GraphRecursionError|GRAPH_RECURSION_LIMIT|Recursion limit of \d+ reached/iu.test(detail)) {
    const message = "本轮执行达到安全上限，已停止继续运行。请缩小任务范围或补充停止条件后再试。";
    return {
      category: "limit",
      detail: detail || message,
      message,
      summary: "执行达到安全上限",
      technicalDetail: detail.length > 0 ? detail : null,
      title: "执行达到安全上限",
    };
  }

  const httpStatus = detail.match(/\bHTTP\s+(\d{3})\b/iu)?.[1] ?? null;
  const isTimeoutStatus = httpStatus === "408" || httpStatus === "504";
  const category = normalized.includes("401")
    || normalized.includes("403")
    || /模型认证失败|api key|apikey|unauthorized|forbidden/iu.test(detail)
    ? "authentication"
    : normalized.includes("402")
      || normalized.includes("429")
      || /额度不足|余额不足|请求过于频繁|too many requests|quota|insufficient credit/iu.test(detail)
      ? "quota"
      : isTimeoutStatus
        || (httpStatus === null && /请求超时|连接超时|timed out|timeout/iu.test(detail))
        ? "timeout"
        : /接口错误|模型服务暂时不可用|gateway|upstream|\b5\d{2}\b/iu.test(detail)
          ? "provider"
          : /网络连接失败|网络错误详情|fetch failed|socket|econn|connection failed|error sending request/iu.test(detail)
            ? "network"
            : /模型未返回|响应无法处理|无法处理的响应|empty response|incomplete response/iu.test(detail)
              ? "response"
              : /内部错误|软件内部|ipc|sqlite|database|module not found/iu.test(detail)
                ? "internal"
                : "unknown";
  const labels: Record<Exclude<ConversationErrorCategory, "limit" | "tool" | "unknown">, string> = {
    authentication: "模型认证失败",
    internal: "软件内部错误",
    network: "网络连接失败",
    provider: "模型服务返回错误",
    quota: "模型额度或频率受限",
    response: "模型响应无法处理",
    timeout: "模型请求超时",
  };
  const title = category === "unknown" ? "模型请求未完成" : labels[category];
  const isInternal = category === "internal";
  const message = isInternal
    ? "软件内部发生错误，请稍后重试。如果持续出现，请重新启动软件。"
    : separated.message || title;
  const technicalDetail = isInternal
    ? separated.technicalDetail ?? (detail.length > 0 && detail !== message ? detail : null)
    : separated.technicalDetail;

  return {
    category,
    detail: detail || "模型请求没有返回可显示的错误详情。",
    message,
    summary: category === "unknown" ? summarizeErrorDetail(detail, "模型请求未完成") : title,
    technicalDetail,
    title,
  };
}

function summarizeErrorDetail(detail: string, fallback: string): string {
  const firstLine = detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return fallback;
  const summary = firstLine
    .replace(/^接口错误：HTTP\s+\d+：?/iu, "")
    .replace(/^网络错误详情：/iu, "")
    .replace(/^内部错误详情：/iu, "")
    .trim();
  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary || fallback;
}

function ConversationErrorQuote({
  content,
  scope,
}: {
  content: string;
  scope: ConversationErrorScope;
}): ReactElement {
  const presentation = describeConversationError(content, scope);

  return (
    <div
      className="conversation-error-quote"
      data-category={presentation.category}
      data-scope={scope}
      role="alert"
    >
      <CircleAlert aria-hidden="true" className="conversation-error-quote__icon" size={16} />
      <div className="conversation-error-quote__body">
        <strong className="conversation-error-quote__heading">{presentation.title}</strong>
        <p className="conversation-error-quote__message">{presentation.message}</p>
        {presentation.technicalDetail === null ? null : (
          <details className="conversation-error-quote__technical">
            <summary>
              <ChevronRight aria-hidden="true" size={14} />
              查看技术详情
            </summary>
            <pre>{presentation.technicalDetail}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
