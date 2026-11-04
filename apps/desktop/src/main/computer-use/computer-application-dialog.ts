import { app, dialog, type BrowserWindow, type NativeImage } from "electron";
import type { ComputerApplication } from "@agent/protocol";
import type { ComputerAccessDecision } from "./computer-application-permissions.js";
import { reportMainError, toMainAgentError } from "../errors/agent-error.js";

export async function requestComputerApplicationAccess(getWindow: () => BrowserWindow | null, application: ComputerApplication, signal: AbortSignal): Promise<ComputerAccessDecision> {
  signal.throwIfAborted();
  const window = getWindow();
  if (window === null || window.isDestroyed()) return "deny";
  let icon: NativeImage | undefined;
  try { icon = await app.getFileIcon(application.executablePath, { size: "normal" }); }
  catch (error) { reportMainError(toMainAgentError(error, { operation: "computer_use.permission_icon" }), error, [application.executablePath]); }
  signal.throwIfAborted();
  const result = await dialog.showMessageBox(window, {
    type: "question", title: "电脑控制 · 软件授权", message: `允许 Agent 查看和操作 ${application.name}？`,
    detail: `${application.executablePath}\n\n仅本次允许：停止控制或按 Esc 后失效。\n永久允许：保留到设置中的授权列表，可随时撤销。`,
    ...(icon === undefined ? {} : { icon }), buttons: ["拒绝", "仅本次允许", "永久允许"], defaultId: 0, cancelId: 0, noLink: true, signal,
  });
  signal.throwIfAborted();
  return result.response === 1 ? "session" : result.response === 2 ? "permanent" : "deny";
}
