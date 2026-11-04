import type { ConversationToolItem } from "@agent/protocol";
import { CircleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { describeConversationError } from "./conversation-error.js";
import { parseToolError } from "./tool-result-payload.js";

export function StructuredToolResult({
  children,
  summary,
}: {
  children: ReactNode;
  summary: ReactNode;
}): ReactElement {
  return (
    <section className="tool-timeline-item__payload tool-structured-result">
      <p className="tool-timeline-item__payload-label">{summary}</p>
      <div className="tool-structured-result__content">{children}</div>
    </section>
  );
}

export function ToolResultNotice({
  result,
  status,
}: {
  result: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const error = result === null ? null : parseToolError(result);
  if (error !== null) return <ToolErrorNotice message={error} />;
  if (status === "failed") {
    return <ToolErrorNotice message={result?.trim() || "工具调用失败，请查看原始调用。"} />;
  }
  const message = status === "running" ? "正在执行" : "调用已完成，可查看原始调用。";

  return (
    <section className="tool-timeline-item__result-notice">
      <p>{message}</p>
    </section>
  );
}

export function ToolErrorNotice({ message }: { message: string }): ReactElement {
  const presentation = describeConversationError(message, "tool");

  return (
    <section
      className="tool-timeline-item__payload tool-structured-result"
      data-status="failed"
      role="alert"
    >
      <p className="tool-timeline-item__payload-label flex items-center gap-1.5">
        <CircleAlert
          aria-hidden="true"
          className="text-[var(--app-status-danger-fg)]"
          size={14}
        />
        <span className="text-[var(--app-status-danger-fg)]">失败原因</span>
      </p>
      <div className="tool-structured-result__content">
        <p
          className="m-0 max-h-40 overflow-auto whitespace-pre-wrap px-2 py-2 text-[length:var(--app-font-size-control)] leading-5 text-[var(--app-foreground)] [overflow-wrap:anywhere]"
          data-tool-error-detail
        >
          {presentation.detail}
        </p>
      </div>
    </section>
  );
}

export async function copyTextWithFeedback(
  text: string,
  setCopied: (copied: boolean) => void,
  writeClipboardText = (value: string): Promise<void> => navigator.clipboard.writeText(value),
): Promise<void> {
  try {
    await writeClipboardText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  } catch {
    setCopied(false);
  }
}
