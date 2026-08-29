import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TERMINAL_CONFIGURATION } from "@agent/protocol";

import { TerminalSessionController } from "./terminal-session-controller.js";

const projectId = "00000000-0000-4000-8000-000000000001";

function createFakePty() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number }) => void) | undefined;
  const process = {
    kill: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    }),
    resize: vi.fn(),
    write: vi.fn(),
  };
  return {
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
    process,
  };
}

describe("TerminalSessionController", () => {
  it("owns an interactive PTY lifecycle and emits bounded data and exit events", async () => {
    const fake = createFakePty();
    let launchOptions: {
      cols: number;
      cwd: string;
      env: Record<string, string>;
      name: string;
      rows: number;
    } | undefined;
    const createPty = vi.fn((
      _executable: string,
      _args: readonly string[],
      options: NonNullable<typeof launchOptions>,
    ) => {
      launchOptions = options;
      return fake.process;
    });
    const controller = new TerminalSessionController(
      { getProject: () => ({ id: projectId, isPinned: false, name: "Agent", rootPath: "D:\\Agent" }) },
      { getConfiguration: () => DEFAULT_TERMINAL_CONFIGURATION },
      createPty,
    );
    const events: unknown[] = [];
    controller.onEvent((event) => events.push(event));

    const session = controller.open({ columns: 120, projectId, rows: 32 });
    controller.write({ data: "git status\r", sessionId: session.sessionId });
    controller.resize({ columns: 100, rows: 20, sessionId: session.sessionId });
    fake.emitData("working tree clean\r\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    fake.emitExit(0);

    expect(createPty).toHaveBeenCalledOnce();
    expect(launchOptions).toBeDefined();
    expect(launchOptions?.cols).toBe(120);
    expect(launchOptions?.cwd).toBe("D:\\Agent");
    expect(launchOptions?.env.COLORTERM).toBe("truecolor");
    expect(launchOptions?.env.NO_COLOR).toBeUndefined();
    expect(launchOptions?.env.TERM).toBe("xterm-256color");
    expect(launchOptions?.rows).toBe(32);
    expect(fake.process.write).toHaveBeenCalledWith("git status\r");
    expect(fake.process.resize).toHaveBeenCalledWith(100, 20);
    expect(events).toEqual([
      { data: "working tree clean\r\n", sessionId: session.sessionId, type: "data" },
      { exitCode: 0, sessionId: session.sessionId, type: "exit" },
    ]);
    expect(() => controller.write({ data: "x", sessionId: session.sessionId })).toThrow(
      "终端会话不存在或已经结束",
    );
  });

  it("coalesces PTY output received during the same event-loop turn", async () => {
    const fake = createFakePty();
    const controller = new TerminalSessionController(
      { getProject: () => ({ id: projectId, isPinned: false, name: "Agent", rootPath: "D:\\Agent" }) },
      { getConfiguration: () => DEFAULT_TERMINAL_CONFIGURATION },
      () => fake.process,
    );
    const events: unknown[] = [];
    controller.onEvent((event) => events.push(event));

    const session = controller.open({ columns: 80, projectId, rows: 24 });
    fake.emitData("first ");
    fake.emitData("prompt");
    fake.emitData("\r\n");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual([
      { data: "first prompt\r\n", sessionId: session.sessionId, type: "data" },
    ]);
    expect(controller.readOutput({ afterCursor: 0, maxChars: 5, sessionId: session.sessionId }))
      .toEqual({ data: "first", nextCursor: 5, truncated: true });
    expect(controller.readOutput({ afterCursor: 5, maxChars: 100, sessionId: session.sessionId }))
      .toEqual({ data: " prompt\r\n", nextCursor: 14, truncated: false });
  });

  it("kills active PTYs during application disposal", () => {
    const fake = createFakePty();
    const controller = new TerminalSessionController(
      { getProject: () => ({ id: projectId, isPinned: false, name: "Agent", rootPath: "D:\\Agent" }) },
      { getConfiguration: () => DEFAULT_TERMINAL_CONFIGURATION },
      () => fake.process,
    );
    controller.open({ columns: 80, projectId, rows: 24 });

    controller.dispose();

    expect(fake.process.kill).toHaveBeenCalledOnce();
  });

  it("prefers the configured executable path for the selected shell", () => {
    const fake = createFakePty();
    const createPty = vi.fn(() => fake.process);
    const controller = new TerminalSessionController(
      { getProject: () => ({ id: projectId, isPinned: false, name: "Agent", rootPath: "D:\\Agent" }) },
      {
        getConfiguration: () => ({
          ...DEFAULT_TERMINAL_CONFIGURATION,
          shell: "pwsh",
          shellPaths: {
            ...DEFAULT_TERMINAL_CONFIGURATION.shellPaths,
            pwsh: process.execPath,
          },
        }),
      },
      createPty,
    );

    const session = controller.open({ columns: 80, projectId, rows: 24 });

    expect(session.shellLabel).toBe("PWSH（PowerShell 7）");
    expect(createPty).toHaveBeenCalledWith(
      process.execPath,
      ["-NoLogo"],
      expect.objectContaining({ cwd: "D:\\Agent" }),
    );
  });

  it("returns an actionable error when the PTY cannot be created", () => {
    const controller = new TerminalSessionController(
      { getProject: () => ({ id: projectId, isPinned: false, name: "Agent", rootPath: "D:\\Agent" }) },
      { getConfiguration: () => DEFAULT_TERMINAL_CONFIGURATION },
      () => {
        throw new Error("File not found");
      },
    );

    expect(() => controller.open({ columns: 80, projectId, rows: 24 })).toThrow(
      expect.objectContaining({
        code: "TERMINAL_LAUNCH_FAILED",
        message: "无法启动Windows PowerShell。请检查设置中的终端启动路径和项目目录。",
      }),
    );
  });
});
