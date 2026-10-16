import { useEffect, useState } from "react";
import type { ConversationAttachment } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { LoadingState } from "../../components/ui/loading.js";
import { requestMediaPreview } from "../../components/media/image-viewer.js";

export function BrowserScreenshotResult({ agentClient, image }: {
  agentClient: AgentClient; image: ConversationAttachment;
}) {
  const [preview, setPreview] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    void agentClient.readConversationAttachmentPreview({ conversationId: image.conversationId, attachmentId: image.id })
      .then((result) => {
        if (!disposed) setPreview({ id: image.id, url: `data:${result.mimeType};base64,${result.data}` });
      }).catch(() => { if (!disposed) setPreview({ id: image.id, url: null }); });
    return () => { disposed = true; };
  }, [agentClient, image.conversationId, image.id]);
  if (preview?.id !== image.id) return <LoadingState label="正在读取网页截图…" compact />;
  if (preview.url === null) return <p className="m-0 text-[var(--app-muted-foreground)]" role="status">截图无法读取，可能已被清理。</p>;
  const url = preview.url;
  return <button type="button" aria-label="放大网页截图"
    className="block w-full min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-0 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
    onClick={() => requestMediaPreview({ src: url, title: "网页截图", alt: "浏览器操作时的页面截图" })}>
    <img src={url} alt="浏览器操作时的页面截图" className="block max-h-[520px] w-full object-contain" />
  </button>;
}
