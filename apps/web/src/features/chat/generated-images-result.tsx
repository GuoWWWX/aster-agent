import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { imageGenerationResultSchema, type ConversationAttachment, type ConversationToolItem } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { requestMediaPreview } from "../../components/media/image-viewer.js";
import { ImagePreviewStrip } from "./image-preview-strip.js";

const ImageDetailsContext = createContext<{ visible: ReadonlySet<string>; setVisible: (id: string, visible: boolean) => void } | null>(null);

/** Display the delivery once: inside opened tool details, otherwise in the answer. */
export function ImageGenerationVisibilityProvider({ children }: { children: ReactNode }) {
  const [visible, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set());
  const setVisible = useCallback((id: string, expanded: boolean) => setVisibleIds(current => {
    if (current.has(id) === expanded) return current;
    const next = new Set(current); if (expanded) next.add(id); else next.delete(id); return next;
  }), []);
  return <ImageDetailsContext.Provider value={{ visible, setVisible }}>{children}</ImageDetailsContext.Provider>;
}

export function GeneratedImagesResult({ agentClient, item, placement = "delivery" }: { agentClient: AgentClient; item: ConversationToolItem; placement?: "delivery" | "tool" }) {
  const visibility = useContext(ImageDetailsContext), setVisible = visibility?.setVisible;
  useEffect(() => {
    if (placement !== "tool" || setVisible === undefined) return;
    setVisible(item.id, true);
    return () => setVisible(item.id, false);
  }, [item.id, placement, setVisible]);
  if (placement === "delivery" && visibility?.visible.has(item.id)) return null;
  let count = 1;
  try { const args: unknown = JSON.parse(item.arguments); if (args && typeof args === "object" && "count" in args && typeof args.count === "number") count = Math.max(1, Math.min(10, Math.floor(args.count))); } catch { /* Historical malformed arguments still have a bounded placeholder. */ }
  let result;
  try { result = imageGenerationResultSchema.safeParse(JSON.parse(item.result ?? "null")); } catch { result = null; }
  const images = result?.success ? result.data.value.images : [];
  const pending = item.status === "running" || item.status === "awaiting_approval";
  let error: string | null = null;
  try { const payload: unknown = JSON.parse(item.result ?? "null"); if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") error = payload.error; } catch { /* Malformed historical results get the status fallback. */ }
  const status = item.status === "awaiting_approval" ? "等待批准后开始生成"
    : item.status === "running" ? `正在生成 · 已完成 ${images.length}/${count}`
    : item.status === "cancelled" ? `图片生成已取消${images.length ? "，已完成的图片已保留" : ""}`
    : item.status === "rejected" ? "本次图片生成未获批准"
    : item.status === "failed" || images.length === 0 ? error ?? "图片生成未完成，请查看工具的失败详情。"
    : `已生成 ${images.length} 张图片`;
  return <div className="min-w-0 max-w-full">
    <p className="m-0 pb-[5px] text-[var(--app-muted-foreground)]" role="status">{status}</p>
    <ImagePreviewStrip label={pending ? "图片生成进度" : "生成的图片"}>
      {images.map(image => <GeneratedImage key={image.id} image={image} agentClient={agentClient} />)}
      {pending ? Array.from({ length: Math.max(0, count - images.length) }, (_, i) => <div key={i} className={`flex aspect-square w-48 shrink-0 flex-col items-center justify-center gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] text-[var(--app-muted-foreground)] ${item.status === "running" ? "animate-pulse motion-reduce:animate-none" : ""}`}>
        <ImageIcon size={28} aria-hidden="true" /><span>{item.status === "awaiting_approval" ? "等待批准" : `正在生成 ${images.length + i + 1}/${count}`}</span>
      </div>) : null}
    </ImagePreviewStrip>
    {result?.success && result.data.value.notice ? <p className="m-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{result.data.value.notice}</p> : null}
  </div>;
}

function GeneratedImage({ agentClient, image }: { agentClient: AgentClient; image: ConversationAttachment }) {
  const [preview, setPreview] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    void agentClient.readConversationAttachmentPreview({ conversationId: image.conversationId, attachmentId: image.id })
      .then(result => { if (!disposed) setPreview({ id: image.id, url: `data:${result.mimeType};base64,${result.data}` }); })
      .catch(() => { if (!disposed) setPreview({ id: image.id, url: null }); });
    return () => { disposed = true; };
  }, [agentClient, image.conversationId, image.id]);
  if (preview?.id !== image.id) return <div className="aspect-square w-48 shrink-0 animate-pulse rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] motion-reduce:animate-none" aria-label="正在读取生成图片" />;
  if (preview.url === null) return <p role="status">生成图片无法读取</p>;
  const url = preview.url;
  return <button type="button" className="block aspect-square w-48 shrink-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] p-0 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]" aria-label={`放大生成图片 ${image.name}`}
    onClick={() => requestMediaPreview({ src: url, title: image.name, alt: "生成图片" })}><img src={url} alt={image.name} className="block h-full w-full object-cover" /></button>;
}
