import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";

export function ImageGenerationComposer({ disabled, onChoose }: { disabled: boolean; onChoose: (count: number) => void }) {
  const [open, setOpen] = useState(false), [count, setCount] = useState(1);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <IconButton label="生成图片" disabled={disabled} size="compact" type="button" variant="quiet"><ImagePlus size={15} aria-hidden="true" /></IconButton>
  </PopoverTrigger><PopoverContent side="top" align="start" className="w-56 p-3">
    <p className="m-0 mb-2 font-semibold">生成图片</p>
    <label className="mb-3 flex items-center justify-between gap-[5px]"><span>生成数量</span><Select value={String(count)} onValueChange={value => setCount(Number(value))}>
      <SelectTrigger aria-label="生成图片数量" className="w-20"><SelectValue /></SelectTrigger>
      <SelectContent>{Array.from({ length: 10 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1} 张</SelectItem>)}</SelectContent>
    </Select></label>
    <p className="m-0 mb-3 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">填写描述；需要参考图时，用附件按钮添加图片。</p>
    <button type="button" className="w-full rounded-[var(--app-radius)] bg-[var(--app-accent)] px-3 py-1.5 text-[var(--app-accent-foreground)]" onClick={() => { onChoose(count); setOpen(false); }}>用于这条消息</button>
  </PopoverContent></Popover>;
}
