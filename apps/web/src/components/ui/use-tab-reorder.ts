import { useRef, useState, type DragEvent } from "react";

import "./tab-reorder.css";

export function useTabReorder(
  onMove: (source: string, target: string, side: "before" | "after") => void,
) {
  const sourceRef = useRef<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  function finish() {
    sourceRef.current = null;
    setSource(null);
    setDrop(null);
  }
  function sideAt(event: DragEvent<HTMLElement>): "before" | "after" {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
  }
  const tabProps = (id: string) => ({
    draggable: true,
    "data-reorder-tab-id": id,
    "data-tab-dragging": source === id ? "true" : undefined,
    "data-tab-drop": drop?.id === id ? drop.side : undefined,
    onDragStart(event: DragEvent<HTMLElement>) {
      sourceRef.current = id;
      setSource(id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      event.stopPropagation();
    },
    onDragOver(event: DragEvent<HTMLElement>) {
      if (sourceRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDrop({ id, side: sideAt(event) });
      const list = event.currentTarget.parentElement;
      if (list !== null) {
        const bounds = list.getBoundingClientRect();
        if (event.clientX < bounds.left + 32) list.scrollLeft -= 24;
        if (event.clientX > bounds.right - 32) list.scrollLeft += 24;
      }
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
        setDrop((current) => current?.id === id ? null : current);
      }
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (sourceRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      onMove(sourceRef.current, id, sideAt(event));
      finish();
    },
    onDragEnd: finish,
  });
  function listTarget(event: DragEvent<HTMLElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-reorder-tab-id]"));
    const target = tabs.find((tab) => {
      const bounds = tab.getBoundingClientRect();
      return event.clientX < bounds.left + bounds.width / 2;
    });
    const id = (target ?? tabs.at(-1))?.dataset.reorderTabId;
    return id === undefined ? null : { id, side: target === undefined ? "after" as const : "before" as const };
  }
  return {
    tabProps,
    listProps: {
      "data-tab-reordering": source === null ? undefined : "true",
      onDragOver(event: DragEvent<HTMLElement>) {
        if (sourceRef.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDrop(listTarget(event));
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (sourceRef.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        const target = listTarget(event);
        if (target !== null) onMove(sourceRef.current, target.id, target.side);
        finish();
      },
    },
  };
}
