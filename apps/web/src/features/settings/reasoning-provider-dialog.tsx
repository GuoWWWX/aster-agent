import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { Upload } from "lucide-react";
import { modelReasoningProviderSchema, type ModelReasoningProvider } from "@agent/protocol";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.js";
import { ProviderIconPicker, ProviderLogo } from "./provider-logo.js";
import { REASONING_API_FORMATS } from "./model-reasoning-catalog-draft.js";

export function ReasoningProviderLogo({ provider, large = false }: { provider: ModelReasoningProvider; large?: boolean }): ReactElement {
  return provider.imageDataUrl === undefined
    ? <ProviderLogo className={large ? "!size-14 !text-[length:var(--app-font-size-title)]" : undefined} icon={provider.icon} providerName={provider.name} size="small" />
    : <img alt="" src={provider.imageDataUrl} className={`${large ? "size-14" : "size-6"} shrink-0 rounded-[var(--app-radius-small)] object-contain`} />;
}

export function ReasoningProviderDialog({ provider, isNew, onClose, onSave }: {
  provider: ModelReasoningProvider;
  isNew: boolean;
  onClose: () => void;
  onSave: (provider: ModelReasoningProvider) => void;
}): ReactElement {
  const [draft, setDraft] = useState(provider);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const readerRef = useRef<FileReader | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { readerRef.current?.abort(); }, []);

  function upload(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) return;
    readerRef.current?.abort();
    setUploading(false);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 256 * 1024) {
      setError("请选择不超过 256 KB 的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    const reader = new FileReader();
    readerRef.current = reader;
    setUploading(true);
    setError(null);
    reader.onload = () => {
      setUploading(false);
      const parsed = modelReasoningProviderSchema.shape.imageDataUrl.safeParse(reader.result);
      if (!parsed.success || parsed.data === undefined) { setError("无法读取所选图片。"); return; }
      setDraft(current => ({ ...current, imageDataUrl: parsed.data }));
    };
    reader.onerror = () => { setUploading(false); setError("无法读取所选图片。"); };
    reader.readAsDataURL(file);
  }

  function submit(): void {
    const parsed = modelReasoningProviderSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.some(issue => issue.path.includes("sourceUrl"))
        ? "官方文档地址必须是有效的 HTTP 或 HTTPS 地址。"
        : "请填写供应商名称，并至少勾选一种对话协议。");
      return;
    }
    onSave(parsed.data);
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto border border-[var(--app-border)] p-4">
      <DialogHeader>
        <DialogTitle>{isNew ? "添加供应商" : "编辑供应商"}</DialogTitle>
        <DialogDescription>维护推理程度目录中的供应商与可选协议。</DialogDescription>
      </DialogHeader>
      <label className="grid gap-[5px] text-[length:var(--app-font-size-control)]">名称
        <input aria-label="供应商名称" maxLength={200} className="h-8 w-full min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <div className="grid gap-[5px] text-[length:var(--app-font-size-control)]">
        <span>Logo</span>
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="上传供应商 Logo" title="点击 Logo 上传图片" onClick={() => fileRef.current?.click()}
            className="group relative size-14 shrink-0 overflow-hidden rounded-[var(--app-radius)] outline-none ring-[var(--app-border)] transition-shadow hover:ring-2 focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]">
            <ReasoningProviderLogo provider={draft} large />
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Upload size={22} /></span>
          </button>
          <input ref={fileRef} aria-label="供应商 Logo 文件" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} />
          <div className="min-w-0 flex-1"><ProviderIconPicker inDialog icon={draft.icon} providerName={draft.name} onIconChange={icon => {
            readerRef.current?.abort();
            setUploading(false);
            setDraft(current => { const { imageDataUrl: _image, ...rest } = current; void _image; return { ...rest, icon }; });
            setError(null);
          }} /></div>
        </div>
        <p className="m-0 text-[var(--app-muted-foreground)]">点击 Logo 上传 PNG、JPEG、WebP，最大 256 KB；右侧可选择内置图标。</p>
      </div>
      <label className="grid gap-[5px] text-[length:var(--app-font-size-control)]">官方文档地址
        <input aria-label="供应商官方文档地址" type="url" maxLength={2000} placeholder="https://…（可选）"
          className="h-8 w-full min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
          value={draft.sourceUrl ?? ""} onChange={event => setDraft(current => {
            const { sourceUrl: _source, ...rest } = current; void _source;
            return event.target.value.trim() ? { ...rest, sourceUrl: event.target.value.trim() } : rest;
          })} />
      </label>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 text-[length:var(--app-font-size-control)]">支持的对话协议</legend>
        {REASONING_API_FORMATS.map(format => <label key={format.value} className="flex items-center gap-2 text-[length:var(--app-font-size-control)]">
          <input type="checkbox" checked={draft.apiFormats.includes(format.value)} onChange={event => setDraft({ ...draft,
            apiFormats: event.target.checked ? [...draft.apiFormats, format.value] : draft.apiFormats.filter(value => value !== format.value) })} />
          {format.label}
        </label>)}
        <p className="m-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">决定模型配置可选的协议；取消勾选会停用对应配置，重新勾选后恢复。</p>
      </fieldset>
      {error === null ? null : <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}</p>}
      <DialogFooter>
        <button type="button" className="settings-secondary-button" onClick={onClose}>取消</button>
        <button type="button" className="settings-primary-button" disabled={uploading} onClick={submit}>{uploading ? "读取图片…" : "确定"}</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
