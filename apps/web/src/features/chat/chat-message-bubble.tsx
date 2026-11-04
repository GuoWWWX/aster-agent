import type { ReactElement, ReactNode } from "react";

/** Shared message surface for individual conversations and team discussions. */
export function ChatMessageBubble({ role, status = "completed", enclosed = false, children }: {
  role: "user" | "assistant"; status?: string; enclosed?: boolean; children: ReactNode;
}): ReactElement {
  return <article className={`chat-message${enclosed ? " chat-message--enclosed" : ""}`} data-role={role} data-status={status}>{children}</article>;
}
