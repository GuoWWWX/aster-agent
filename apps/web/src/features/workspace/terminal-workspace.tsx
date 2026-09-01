import { useEffect, useRef, type ReactElement } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { TerminalSession } from "@agent/protocol";

import { type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

export function shouldHandleTerminalKeyEvent(
  event: Pick<KeyboardEvent, "key" | "repeat" | "type">,
): boolean {
  return !(event.type === "keydown" && event.key === "Enter" && event.repeat);
}

export function TerminalWorkspace({
  active,
  agentClient,
  projectId,
  session,
  onError,
  onSessionOpened,
}: {
  active: boolean;
  agentClient: AgentClient;
  projectId: string;
  session: TerminalSession | null;
  onError: (message: string) => void;
  onSessionOpened: (session: TerminalSession) => void;
}): ReactElement {
  const terminalConfiguration = useWorkbenchUiStore((state) => state.terminalConfiguration);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const onErrorRef = useRef(onError);
  const onSessionOpenedRef = useRef(onSessionOpened);
  const sessionRef = useRef(session);
  const openSessionRef = useRef<(() => void) | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalConfigurationRef = useRef(terminalConfiguration);
  const { fontFamily, fontSize, lineHeight } = terminalConfiguration;

  useEffect(() => {
    activeRef.current = active;
    onErrorRef.current = onError;
    onSessionOpenedRef.current = onSessionOpened;
  }, [active, onError, onSessionOpened]);

  useEffect(() => {
    const previous = sessionRef.current;
    sessionRef.current = session;
    if (session === null && previous !== null) {
      const terminal = terminalRef.current;
      terminal?.clear();
      terminal?.writeln("\x1b[90m终端会话已过期，将在重新打开时启动。\x1b[0m");
    }
    if (session === null && activeRef.current) openSessionRef.current?.();
  }, [session]);

  useEffect(() => {
    terminalConfigurationRef.current = {
      ...terminalConfigurationRef.current,
      fontFamily,
      fontSize,
      lineHeight,
    };
    const terminal = terminalRef.current;
    if (terminal === null) return;
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    terminal.options.lineHeight = lineHeight;
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [
    fontFamily,
    fontSize,
    lineHeight,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    const configuration = terminalConfigurationRef.current;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: configuration.fontFamily,
      fontSize: configuration.fontSize,
      lineHeight: configuration.lineHeight,
      scrollback: 5_000,
      theme: {
        background: "#181818",
        foreground: "#e6e6e6",
        selectionBackground: "#3a3a3a",
      },
    });
    terminal.attachCustomKeyEventHandler(shouldHandleTerminalKeyEvent);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        // xterm falls back to its built-in renderer when the GPU context disappears.
        webglAddon?.dispose();
        webglAddon = null;
      });
    } catch {
      webglAddon?.dispose();
      webglAddon = null;
    }
    terminal.writeln("\x1b[90m正在启动项目终端…\x1b[0m");

    const pendingOutput: string[] = [];
    let outputFrame: number | null = null;
    const flushOutput = (): void => {
      outputFrame = null;
      const output = pendingOutput.join("");
      pendingOutput.length = 0;
      if (output.length > 0) terminal.write(output);
    };
    const queueOutput = (data: string): void => {
      pendingOutput.push(data);
      if (outputFrame !== null) return;
      outputFrame = window.requestAnimationFrame(flushOutput);
    };
    const disposeEvent = agentClient.onTerminalSessionEvent((event) => {
      if (event.sessionId !== sessionRef.current?.sessionId) return;
      if (event.type === "data") queueOutput(event.data);
      else {
        if (outputFrame !== null) {
          window.cancelAnimationFrame(outputFrame);
          flushOutput();
        }
        terminal.writeln(`\r\n\x1b[90m进程已退出（${event.exitCode ?? "未知"}）\x1b[0m`);
      }
    });
    const replayExistingOutput = (): void => {
      const current = sessionRef.current;
      if (current === null) return;
      void agentClient.readTerminalSessionOutput({
        afterCursor: 0,
        maxChars: 65_536,
        sessionId: current.sessionId,
      }).then((output) => {
        if (disposed || output.data.length === 0 || current.sessionId !== sessionRef.current?.sessionId) return;
        terminal.write(output.data);
      }).catch(() => undefined);
    };
    const inputDisposable = terminal.onData((data) => {
      const current = sessionRef.current;
      if (current !== null) {
        void agentClient.writeTerminalSession({ data, sessionId: current.sessionId }).catch((reason: unknown) => {
          onErrorRef.current(reason instanceof Error ? reason.message : "终端输入失败。");
        });
      }
    });
    let disposed = false;
    let opening = false;
    let resizeFrame: number | null = null;
    let terminalSize: { columns: number; rows: number } | null = null;
    const open = async (): Promise<void> => {
      if (disposed || opening || sessionRef.current !== null) return;
      opening = true;
      try {
        fitAddon.fit();
        const initialSize = {
          columns: Math.max(2, terminal.cols),
          rows: Math.max(1, terminal.rows),
        };
        terminalSize = initialSize;
        const opened = await agentClient.openTerminalSession({
          columns: initialSize.columns,
          projectId,
          rows: initialSize.rows,
        });
        if (disposed) {
          await agentClient.closeTerminalSession({ sessionId: opened.sessionId });
          return;
        }
        sessionRef.current = opened;
        terminal.clear();
        onSessionOpenedRef.current(opened);
        terminal.focus();
      } catch (reason) {
        onErrorRef.current(reason instanceof Error ? reason.message : "终端启动失败。");
      } finally {
        opening = false;
      }
    };
    openSessionRef.current = () => {
      if (activeRef.current && sessionRef.current === null) void open();
    };
    openSessionRef.current();
    replayExistingOutput();

    const resize = (): void => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (!activeRef.current) return;
        try {
          fitAddon.fit();
        } catch {
          return;
        }
        const nextSize = {
          columns: Math.max(2, terminal.cols),
          rows: Math.max(1, terminal.rows),
        };
        if (terminalSize?.columns === nextSize.columns && terminalSize.rows === nextSize.rows) return;
        terminalSize = nextSize;
        const current = sessionRef.current;
        if (current !== null) {
          void agentClient.resizeTerminalSession({
            ...nextSize,
            sessionId: current.sessionId,
          }).catch(() => undefined);
        }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => {
      disposed = true;
      observer.disconnect();
      if (outputFrame !== null) window.cancelAnimationFrame(outputFrame);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      pendingOutput.length = 0;
      inputDisposable.dispose();
      disposeEvent();
      openSessionRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [agentClient, projectId]);

  useEffect(() => {
    if (active) openSessionRef.current?.();
  }, [active]);

  return (
    <div className="h-full min-h-0 w-full bg-[#181818] p-2" aria-label="项目终端">
      <div className="h-full min-h-0 w-full" ref={containerRef} />
    </div>
  );
}
