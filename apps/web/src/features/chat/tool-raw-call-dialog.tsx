import type { ConversationToolItem } from "@agent/protocol";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { createDiffPresentation, DiffView } from "../../components/diff/diff-view.js";
import { useNativeOverlayContainer } from "../../components/ui/native-overlay-provider.js";
import { useStreamingScroll } from "../../components/ui/use-streaming-scroll.js";
import { formatToolPayload } from "./tool-result-payload.js";

export function ToolRawCallDialog({
  item,
  onClose,
}: {
  item: ConversationToolItem;
  onClose: () => void;
}): ReactElement {
  const nativeOverlayContainer = useNativeOverlayContainer();
  const scrollHost = useRef<HTMLDivElement>(null);
  useStreamingScroll(scrollHost, `${item.arguments}\n${item.result ?? ""}`, item.status === "running");
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      ref={scrollHost}
      className="tool-raw-dialog-backdrop"
      data-native-view-overlay=""
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={`${item.name} 原始调用`}
        aria-modal="true"
        className="tool-raw-dialog"
        role="dialog"
      >
        <header className="tool-raw-dialog__header">
          <div>
            <p>原始调用</p>
            <h2>{item.name}</h2>
          </div>
          <button aria-label="关闭原始调用" title="关闭" type="button" onClick={onClose}>
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="tool-raw-dialog__content">
          <ToolPayload label="调用参数" payload={item.arguments} />
          {item.result === null ? null : <ToolPayload label="调用结果" payload={item.result} />}
          {item.diff === null ? null : (
            <section className="tool-timeline-item__payload">
              <p className="tool-timeline-item__payload-label">变更 Diff</p>
              <DiffView presentation={createDiffPresentation(item.diff)} />
            </section>
          )}
        </div>
      </section>
    </div>,
    nativeOverlayContainer ?? document.body,
  );
}

function ToolPayload({ label, payload }: { label: string; payload: string }): ReactElement {
  return (
    <section className="tool-timeline-item__payload">
      <p className="tool-timeline-item__payload-label">{label}</p>
      <pre>{formatToolPayload(payload)}</pre>
    </section>
  );
}
