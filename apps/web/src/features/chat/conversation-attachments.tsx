import type { ConversationAttachment } from "@agent/protocol";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { Spinner } from "../../components/ui/loading.js";
import { useMediaPreview } from "../../components/media/image-viewer.js";
import type { AgentClient } from "../../runtime/index.js";
import { imageDisplayName } from "./conversation-image-preview.js";

export function AttachmentChip({
  agentClient,
  attachment,
  isRemoving = false,
  onRemove,
  previewUrl,
}: {
  agentClient: AgentClient;
  attachment: ConversationAttachment;
  isRemoving?: boolean;
  onRemove?: () => void;
  previewUrl?: string;
}): ReactElement {
  const openPreview = useMediaPreview();
  const label = attachment.kind === "image" ? imageDisplayName(attachment) : attachment.name;
  const [storedPreviewUrl, setStoredPreviewUrl] = useState<string | null>(null);
  const sourceLabel = attachment.projectPath ?? "上传文件";
  const isDraft = onRemove !== undefined;
  useEffect(() => {
    if (attachment.kind !== "image" || previewUrl !== undefined) return;
    let cancelled = false;
    void agentClient.readConversationAttachmentPreview({
      attachmentId: attachment.id,
      conversationId: attachment.conversationId,
    }).then((preview) => {
      if (!cancelled) {
        setStoredPreviewUrl(`data:${preview.mimeType};base64,${preview.data}`);
      }
    }).catch(() => {
      if (!cancelled) setStoredPreviewUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [agentClient, attachment.conversationId, attachment.id, attachment.kind, previewUrl]);
  const resolvedPreviewUrl = previewUrl ?? storedPreviewUrl ?? undefined;
  const showsImagePreview = attachment.kind === "image" && resolvedPreviewUrl !== undefined;
  return (
    <span
      className={[
        "conversation-attachment",
        isDraft ? "conversation-attachment--draft" : "",
        showsImagePreview
          ? "conversation-attachment--image-preview"
          : "conversation-attachment--file-card",
      ].filter(Boolean).join(" ")}
      title={`${label} · ${sourceLabel} · ${formatFileSize(attachment.sizeBytes)}`}
    >
      {showsImagePreview ? (
        <button
          aria-label={`预览图片 ${label}`}
          className="conversation-attachment__image-button"
          type="button"
          onClick={() => openPreview({
            imageKey: attachment.id,
            alt: label,
            src: resolvedPreviewUrl,
            title: label,
          })}
        >
          <img alt={label} src={resolvedPreviewUrl} />
        </button>
      ) : (
        <>
          <span className="conversation-attachment__file-icon">
            <FileTypeIcon path={attachment.name} size={28} />
          </span>
          <span className="conversation-attachment__identity">
            <strong>{label}</strong>
            <small>
              {attachmentTypeLabel(attachment)} · {formatFileSize(attachment.sizeBytes)}
              {!isDraft && attachment.truncated ? " · 已按预览注入" : ""}
            </small>
          </span>
        </>
      )}
      {onRemove === undefined ? null : (
        <button
          aria-label={`移除附件 ${attachment.name}`}
          className="conversation-attachment__remove-button"
          disabled={isRemoving}
          type="button"
          onClick={onRemove}
        >
          {isRemoving ? (
            <Spinner aria-hidden="true" size={13} />
          ) : (
            <X aria-hidden="true" size={13} />
          )}
        </button>
      )}
    </span>
  );
}

export function AttachmentStrip({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "draft" | "message";
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const handleWheel = (event: WheelEvent): void => {
      handleHorizontalAttachmentWheel(container, event);
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);
  return (
    <div
      ref={containerRef}
      className={`conversation-attachments conversation-attachments--${variant}`}
    >
      {children}
    </div>
  );
}

function handleHorizontalAttachmentWheel(
  container: HTMLDivElement,
  event: WheelEvent,
): void {
  if (container.scrollWidth <= container.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (delta === 0) return;
  event.preventDefault();
  container.scrollLeft += delta;
}

function attachmentTypeLabel(attachment: ConversationAttachment): string {
  const extensionMatch = /\.([^.]+)$/u.exec(attachment.name.trim());
  if (extensionMatch?.[1] !== undefined && extensionMatch[1].length <= 12) {
    return extensionMatch[1].toLocaleUpperCase();
  }
  const mimeSubtype = attachment.mimeType.split("/").at(-1)?.split("+")[0]?.trim();
  return mimeSubtype === undefined || mimeSubtype.length === 0
    ? "FILE"
    : mimeSubtype.toLocaleUpperCase();
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${Math.ceil(sizeBytes / 1_024)} KB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
