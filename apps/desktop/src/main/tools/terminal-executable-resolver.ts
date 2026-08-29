import { existsSync } from "node:fs";
import path from "node:path";

import type { TerminalConfiguration, TerminalShell } from "@agent/protocol";

type ResolvedTerminalShell = Exclude<TerminalShell, "system">;

export class TerminalExecutableResolutionError extends Error {
  public readonly code = "TERMINAL_LAUNCH_FAILED";

  public constructor(message: string) {
    super(message);
    this.name = "TerminalExecutableResolutionError";
  }
}

export function resolveTerminalExecutable(
  configuration: TerminalConfiguration,
  shell: ResolvedTerminalShell,
  fallback: string,
): string {
  const configuredPath = configuration.shellPaths[shell];
  if (configuredPath.length > 0) {
    if (!path.isAbsolute(configuredPath)) {
      throw new TerminalExecutableResolutionError("终端启动路径必须是可执行文件的绝对路径。");
    }
    if (!existsSync(configuredPath)) {
      throw new TerminalExecutableResolutionError(
        "终端启动路径不存在，请在设置中检查对应终端的可执行文件路径。",
      );
    }
    return configuredPath;
  }

  if (process.platform !== "win32" || shell !== "pwsh") return fallback;
  return findPowerShellSevenExecutable() ?? fallback;
}

function findPowerShellSevenExecutable(): string | null {
  const installationRoots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const root of installationRoots) {
    const executable = root === process.env.LOCALAPPDATA
      ? path.join(root, "Microsoft", "PowerShell", "7", "pwsh.exe")
      : path.join(root, "PowerShell", "7", "pwsh.exe");
    if (existsSync(executable)) return executable;
  }
  return null;
}
