import apachemaven from "@iconify-icons/simple-icons/apachemaven";
import springboot from "@iconify-icons/simple-icons/springboot";
import gradle from "@iconify-icons/simple-icons/gradle";
import nodedotjs from "@iconify-icons/simple-icons/nodedotjs";
import python from "@iconify-icons/simple-icons/python";
import docker from "@iconify-icons/simple-icons/docker";
import { Icon, type IconifyIcon } from "@iconify/react";
import { ChevronDown, LoaderCircle, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { BackgroundCommand } from "@agent/protocol";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import type { AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

export function programPresentation(command: string, name: string | null): { label: string; icon: IconifyIcon | null } {
  const text = `${name ?? ""} ${command}`;
  if (/spring[ -]?boot|bootRun/iu.test(text)) return { label: "Spring Boot", icon: springboot };
  if (/\bmvnw?\b|maven/iu.test(text)) return { label: "Maven", icon: apachemaven };
  if (/\bgradlew?\b/iu.test(text)) return { label: "Gradle", icon: gradle };
  if (/\bdocker\b/iu.test(text)) return { label: "Docker", icon: docker };
  if (/\bpython(?:3|\.exe)?\b/iu.test(text)) return { label: "Python", icon: python };
  if (/\b(?:node|npm|pnpm|yarn|vite|bun)\b/iu.test(text)) return { label: "Node.js", icon: nodedotjs };
  return { label: "命令", icon: null };
}
const statusLabels = { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止" };

export function BackgroundPrograms({ agentClient, conversationId }: { agentClient: AgentClient; conversationId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<BackgroundCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const openCommand = useWorkbenchUiStore(state => state.openBackgroundCommandView);
  const hasRunningCommands = commands.some(command => command.status === "running");
  const refresh = useCallback(async (signal: AbortSignal): Promise<void> => {
    try {
      const values = await agentClient.listBackgroundCommands({ conversationId });
      if (!signal.aborted) { setCommands(values); setError(null); }
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取后台程序。"); }
  }, [agentClient, conversationId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    const unsubscribe = agentClient.onConversationRunEvent((event) => {
      if (event.type === "tool.completed" || event.type === "run.finished") void refresh(controller.signal);
    });
    const timer = open || hasRunningCommands ? window.setInterval(() => void refresh(controller.signal), 2000) : undefined;
    return () => { controller.abort(); unsubscribe(); if (timer !== undefined) window.clearInterval(timer); };
  }, [agentClient, open, hasRunningCommands, refresh]);
  const stop = async (commandId: string): Promise<void> => {
    setStopping(commandId); setError(null);
    try {
      const command = await agentClient.stopBackgroundCommand({ conversationId, commandId });
      setCommands((current) => current.map((item) => item.commandId === commandId ? command : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法停止程序。"); }
    finally { setStopping(null); }
  };
  const running = commands.filter((command) => command.status === "running").length;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button aria-label="查看后台程序" title="查看后台程序" type="button" className="conversation-header-control" data-open={open}>
      <Terminal aria-hidden="true" size={14} /><span>运行</span>{running > 0 ? <span className="conversation-header-control__count">{running}</span> : null}<ChevronDown aria-hidden="true" size={13} />
    </button></PopoverTrigger>
    <PopoverContent align="end" side="bottom" sideOffset={5} className="conversation-header-popover w-[min(420px,calc(100vw-24px))]">
      <div className="flex items-center justify-between px-2 py-2 text-[length:var(--app-font-size-auxiliary)]"><strong>后台程序</strong><span className="text-[var(--app-muted-foreground)]">{running} 个运行中</span></div>
      {commands.length === 0 ? <p className="conversation-header-popover__empty">暂无后台程序</p> : <ul className="m-0 max-h-[420px] list-none overflow-auto p-0">
        {commands.map((command) => {
          const presentation = programPresentation(command.command, command.serviceName);
          return <li key={command.commandId} className="flex items-start gap-2 border-t border-[var(--app-border)] px-2 py-3">
            <button type="button" aria-label={`查看 ${command.serviceName || presentation.label} 的执行情况`} title="在右侧工作区查看输出"
              onClick={() => { openCommand({ conversationId, commandId: command.commandId, name: command.serviceName || presentation.label }); setOpen(false); }}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-[var(--app-radius-small)] bg-transparent text-left hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] [font:inherit]">
              <span className="mt-0.5 shrink-0 text-[var(--app-muted-foreground)]">{presentation.icon ? <Icon aria-hidden="true" icon={presentation.icon} width={18} height={18} /> : <Terminal aria-hidden="true" size={18} />}</span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="min-w-0 truncate">{command.serviceName || presentation.label}</strong><span className={command.status === "running" ? "shrink-0 text-[var(--app-accent)]" : "shrink-0 text-[var(--app-muted-foreground)]"}>{statusLabels[command.status]}</span></span>
                <span className="my-1 block truncate font-mono text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]" title={command.command}>{command.command}</span>
                <span className="block truncate text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]" title={command.workingDirectory}>{command.workingDirectory} · {new Date(command.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{command.exitCode === null ? "" : ` · 退出 ${command.exitCode}`}</span>
              </span>
            </button>
            {command.status === "running" ? <button aria-label={`停止 ${command.serviceName || presentation.label}`} title="停止程序及其子进程" type="button" disabled={stopping !== null} onClick={() => void stop(command.commandId)} className="rounded p-1.5 text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] disabled:opacity-40">{stopping === command.commandId ? <LoaderCircle aria-hidden="true" className="animate-spin" size={14} /> : <Square aria-hidden="true" size={14} />}</button> : null}
          </li>;
        })}
      </ul>}
      {error ? <p role="alert" className="conversation-header-popover__error">{error}</p> : null}
    </PopoverContent>
  </Popover>;
}
