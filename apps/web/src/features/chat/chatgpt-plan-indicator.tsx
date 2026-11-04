import type { ModelProfile } from "@agent/protocol";
import type { ReactElement } from "react";

export function ChatGptPlanIndicator({ authentication }: {
  authentication: ModelProfile["providerAuthentication"];
}): ReactElement | null {
  if (authentication !== "chatgpt") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 text-xs text-[var(--app-muted-foreground)]">
      <span>正在使用 ChatGPT 套餐</span>
      <a className="text-[var(--app-accent)] underline" href="https://chatgpt.com/settings/usage" rel="noreferrer" target="_blank">管理用量</a>
    </div>
  );
}
