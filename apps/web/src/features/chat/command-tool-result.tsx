import type { ConversationToolItem } from "@agent/protocol";
import { Check, Copy } from "lucide-react";
import { useRef, useState, type ReactElement } from "react";
import { IconButton } from "../../components/ui/icon-button.js";
import { TerminalText } from "../../components/ui/terminal-text.js";
import { useStreamingScroll } from "../../components/ui/use-streaming-scroll.js";
import { CommandExecutionStatus } from "./command-execution-status.js";
import {
  commandExecutionState,
  commandTerminalClipboardText,
  commandTerminalHeaderLabel,
  commandTerminalOutput,
  parseCommandInvocation,
  parseCommandLifecycleResult,
  parseCommandResult,
  type LiveToolOutput,
} from "./command-tool-result-model.js";
import { StructuredToolResult, ToolResultNotice, copyTextWithFeedback } from "./tool-result-content.js";
import { parseToolValue } from "./tool-result-payload.js";

export function CommandTerminal({
  writeClipboardText,
  argumentsPayload,
  createdAt,
  liveOutput,
  resultPayload,
  status,
}: {
  writeClipboardText: (text: string) => Promise<void>;
  argumentsPayload: string;
  createdAt?: string;
  liveOutput?: LiveToolOutput;
  resultPayload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const invocation = parseCommandInvocation(argumentsPayload);
  const command = invocation?.command ?? "命令参数无法识别，请查看原始调用。";
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  const output = commandTerminalOutput(resultPayload, status, liveOutput);
  const clipboardText = commandTerminalClipboardText(command, output);
  const scrollHost = useRef<HTMLElement>(null);
  useStreamingScroll(scrollHost, output, (liveOutput?.status ?? result?.status ?? status) === "running");

  return (
    <section ref={scrollHost} className="tool-timeline-item__payload tool-structured-result tool-command-terminal">
      <header className="tool-command-terminal__header">
        <span>{commandTerminalHeaderLabel(result?.terminal ?? null)}</span>
        <div className="flex shrink-0 items-center gap-[5px]">
          <CommandExecutionStatus execution={commandExecutionState(status, resultPayload, liveOutput, createdAt)} />
        </div>
        <IconButton
          className="tool-command-terminal__copy"
          label={copied ? "已复制终端内容" : "复制终端内容"}
          size="compact"
          variant="quiet"
          onClick={() => void copyTextWithFeedback(clipboardText, setCopied, writeClipboardText)}
        >
          {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
        </IconButton>
      </header>
      <div className="tool-structured-result__content">
        <pre>
          <code>
            <span className="tool-command-terminal__prompt">$</span> <TerminalText text={command} kind="command" />
            {output.length === 0 ? null : <>{"\n\n"}<TerminalText text={output} /></>}
          </code>
        </pre>
      </div>
    </section>
  );
}

export function CommandLifecycleResult({
  writeClipboardText,
  mode,
  payload,
  status,
}: {
  writeClipboardText: (text: string) => Promise<void>;
  mode: "stop" | "wait";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  if (mode === "stop") {
    const value = payload === null ? null : parseToolValue(payload);
    const command = value?.command;
    if (command === null || typeof command !== "object" || !("status" in command)) {
      return <ToolResultNotice result={payload} status={status} />;
    }
    const pending = "completedAt" in command && command.completedAt === null;
    return (
      <div className="px-2 py-1 text-[length:var(--app-font-size-body)] text-[var(--app-muted-foreground)]" role="status">
        {pending ? "已发送停止请求。" : command.status === "cancelled" ? "后台命令已停止。" : "后台命令已结束，无需再次停止。"}
        {"error" in command && typeof command.error === "string" && command.error.length > 0 ? (
          <p className="mt-1 break-words text-[var(--app-destructive)]">{command.error}</p>
        ) : null}
      </div>
    );
  }
  const result = payload === null ? null : parseCommandLifecycleResult(payload, mode);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  const summary = `${result.waitStatus === "timeout" ? "等待超时" : "等待结束"} · ${result.commands.length} 条命令`;
  return (
    <StructuredToolResult summary={summary}>
      <div className="tool-command-session-list">
        {result.commands.map((command, index) => (
          <CommandTerminal
            writeClipboardText={writeClipboardText}
            key={command.commandId ?? `${command.command}:${index}`}
            argumentsPayload={JSON.stringify({ command: command.command ?? "命令参数不可用" })}
            resultPayload={JSON.stringify({ ok: true, value: command })}
            status={command.status === "running"
              ? "running"
              : command.status === "failed"
                ? "failed"
                : "completed"}
          />
        ))}
      </div>
    </StructuredToolResult>
  );
}
