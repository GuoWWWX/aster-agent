import { Copy, RefreshCw, Square, Terminal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { BackgroundCommandOutput } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { IconButton } from "../../components/ui/icon-button.js";

const statusLabels = { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止" };
export function BackgroundCommandWorkspace({ agentClient, conversationId, commandId, active }: {
  agentClient: AgentClient; conversationId: string; commandId: string; active: boolean;
}): ReactElement {
  const [output, setOutput] = useState<BackgroundCommandOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState<"command" | "output" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let reading = false;
    const refresh = async (): Promise<void> => {
      if (reading) return;
      reading = true;
      try {
        const value = await agentClient.readBackgroundCommand({ conversationId, commandId });
        if (!disposed) {
          setOutput(value); setError(null);
          if (value.command.status !== "running") window.clearInterval(timer);
        }
      } catch (cause) {
        if (!disposed) { setError(cause instanceof Error ? cause.message : "无法读取执行输出。"); window.clearInterval(timer); }
      }
      finally { reading = false; }
    };
    const timer = window.setInterval(() => void refresh(), 1000);
    void refresh();
    return () => { disposed = true; window.clearInterval(timer); };
  }, [active, agentClient, commandId, conversationId, revision]);
  useLayoutEffect(() => { if (active && follow && log.current !== null) log.current.scrollTop = log.current.scrollHeight; }, [active, follow, output]);
  const stop = async (): Promise<void> => {
    setStopping(true); setError(null);
    try { await agentClient.stopBackgroundCommand({ conversationId, commandId }); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法停止程序。"); }
    finally { setStopping(false); }
  };
  const outputText = output === null ? "" : [output.stdout, output.stderr, output.error ?? ""].reduce(
    (text, part) => part ? `${text}${text && !text.endsWith("\n") ? "\n" : ""}${part}` : text, "",
  );
  const copy = async (target: "command" | "output"): Promise<void> => {
    if (output === null) return;
    setCopyError(null);
    try {
      await agentClient.writeClipboardText(target === "command" ? output.command.command : outputText);
      setCopied(target);
    } catch {
      setCopyError(target === "command" ? "无法复制命令。" : "无法复制执行输出。");
    }
  };
  return <section aria-label="后台命令执行详情" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--app-panel)] text-[var(--app-foreground)]">
    <header className="flex shrink-0 items-center gap-[5px] border-b border-[var(--app-border)] px-3 py-2 text-[length:var(--app-font-size-control)]">
      <Terminal aria-hidden="true" size={14} /><strong className="min-w-0 flex-1 truncate">{output?.command.serviceName || "命令执行"}</strong>
      <span>{error !== null ? "读取失败" : output === null ? "加载中" : statusLabels[output.command.status]}</span>
      <IconButton type="button" size="compact" label="刷新执行输出" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></IconButton>
      {output?.command.status === "running" ? <IconButton type="button" size="compact" disabled={stopping} label={stopping ? "正在停止程序" : "停止程序及其子进程"} onClick={() => void stop()}><Square size={14} /></IconButton> : null}
    </header>
    {output === null ? null : <div aria-label="执行命令" className="group/command relative shrink-0 space-y-1 border-b border-[var(--app-border)] px-3 py-2 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
      <code className="block select-text break-all pr-9 text-[var(--app-foreground)]">{output.command.command}</code>
      <IconButton type="button" size="compact" label={copied === "command" ? "已复制命令" : "复制命令"} onClick={() => void copy("command")}
        className="absolute right-2 top-1 opacity-0 group-hover/command:opacity-100 group-focus-within/command:opacity-100 focus-visible:opacity-100"><Copy size={14} /></IconButton>
      <p className="m-0 break-all">{output.command.workingDirectory}</p>
      <p className="m-0">开始 {new Date(output.command.startedAt).toLocaleTimeString()}{output.command.completedAt === null ? "" : ` · 结束 ${new Date(output.command.completedAt).toLocaleTimeString()}`}{output.command.exitCode === null ? "" : ` · 退出码 ${output.command.exitCode}`}{output.timedOut ? " · 已超时" : ""}</p>
    </div>}
    {error === null ? null : <p role="alert" className="m-0 shrink-0 px-3 py-2 text-[length:var(--app-font-size-body)] text-[var(--app-destructive)]">{error}</p>}
    {copyError === null ? null : <p role="alert" className="m-0 shrink-0 px-3 py-2 text-[length:var(--app-font-size-body)] text-[var(--app-destructive)]">{copyError}</p>}
    <div aria-label="执行输出" className="group/output relative min-h-0 flex-1">
      <div ref={log} aria-label="命令输出" className="h-full select-text overflow-auto p-3 pr-12 font-mono text-[length:var(--app-font-size-control)] leading-relaxed" onScroll={() => {
        const element = log.current;
        if (element !== null) setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 30);
      }}>
        {output?.truncated ? <p className="m-0 mb-2 text-[var(--app-muted-foreground)]">仅显示最近输出。</p> : null}
        {output?.stdout ? <pre className="m-0 whitespace-pre-wrap break-all [font:inherit]">{output.stdout}</pre> : null}
        {output?.stderr ? <pre className="m-0 whitespace-pre-wrap break-all text-[var(--app-destructive)] [font:inherit]">{output.stderr}</pre> : null}
        {output?.error ? <p className="m-0 text-[var(--app-destructive)]">{output.error}</p> : null}
        {output !== null && !output.stdout && !output.stderr && !output.error ? <p className="m-0 text-[var(--app-muted-foreground)]">{output.command.status === "running" ? "等待程序输出…" : "程序未输出文字。"}</p> : null}
      </div>
      <IconButton type="button" size="compact" disabled={!outputText} label={copied === "output" ? "已复制执行输出" : "复制执行输出"} onClick={() => void copy("output")}
        className="absolute right-3 top-1 opacity-0 group-hover/output:opacity-100 group-focus-within/output:opacity-100 focus-visible:opacity-100"><Copy size={14} /></IconButton>
    </div>
    <footer className="flex shrink-0 items-center justify-between border-t border-[var(--app-border)] px-3 py-1 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
      <span>{error !== null ? "已暂停更新" : output?.command.status === "running" ? "每秒更新" : "执行输出"}</span><button type="button" className="bg-transparent text-[var(--app-accent)]" onClick={() => setFollow(value => !value)}>{follow ? "暂停自动滚动" : "跟随最新输出"}</button>
    </footer>
  </section>;
}
