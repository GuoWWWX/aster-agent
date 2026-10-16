import { useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HtmlPresentationPage } from "@agent/protocol";
import { IconButton } from "../ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select.js";
import { HtmlPreviewCard } from "./html-preview-card.js";

export function HtmlPreviewGallery({ pages }: { pages: readonly HtmlPresentationPage[] }): ReactElement {
  const [index, setIndex] = useState(0);
  const page = pages[index]!;
  return <section aria-label="HTML 方案对比" className="my-[5px] min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]">
    <HtmlPreviewCard key={index} source={page} embedded />
    <footer className="flex min-w-0 items-center justify-center gap-[5px] border-t border-[var(--app-border)] px-2 py-1">
      <IconButton label="上一个方案" size="compact" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={14} /></IconButton>
      <Select value={String(index)} onValueChange={value => setIndex(Number(value))}>
        <SelectTrigger aria-label="选择预览方案" className="h-7 max-w-[min(320px,70%)] border-transparent shadow-none">
          <span className="min-w-0 truncate" aria-live="polite">{index + 1} / {pages.length} · {page.title}</span>
        </SelectTrigger>
        <SelectContent>{pages.map((option, optionIndex) => <SelectItem key={optionIndex} value={String(optionIndex)}>{optionIndex + 1}. {option.title}</SelectItem>)}</SelectContent>
      </Select>
      <IconButton label="下一个方案" size="compact" disabled={index === pages.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={14} /></IconButton>
    </footer>
  </section>;
}
