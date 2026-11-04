import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUpdateState } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";

export function useAppUpdate(client: AgentClient | undefined) {
  const [state, setState] = useState<AppUpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    const changes = revision;
    changes.current++;
    if (client?.getAppUpdateState === undefined) return;
    let disposed = false;
    const started = changes.current;
    const unsubscribe = client.onAppUpdateChanged?.((next) => {
      if (!disposed) { changes.current++; setState(next); setError(null); }
    });
    void client.getAppUpdateState().then((next) => { if (!disposed && changes.current === started) { setState(next); setError(null); } },
      () => { if (!disposed && changes.current === started) setError("无法读取更新状态。"); });
    return () => { disposed = true; changes.current++; unsubscribe?.(); };
  }, [client]);

  const run = useCallback(async (action: "check" | "download" | "pause" | "install"): Promise<void> => {
    if (client === undefined) return;
    setError(null);
    const started = revision.current;
    try {
      const operation = action === "check" ? client.checkAppUpdate?.() : action === "download" ? client.downloadAppUpdate?.()
        : action === "pause" ? client.pauseAppUpdate?.() : client.installAppUpdate?.();
      if (operation === undefined) return;
      const next = await operation;
      if (revision.current === started) setState(next);
    } catch {
      if (revision.current === started) setError("更新操作失败，请稍后重试。");
    }
  }, [client]);

  return { state, error, run };
}
