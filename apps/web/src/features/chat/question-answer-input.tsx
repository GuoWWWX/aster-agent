import { FileText, Image, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type ReactElement } from "react";
import type { ConversationAttachment } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { QueryTextarea } from "./query-textarea.js";
import { createPastedTextAttachment } from "./pasted-text-attachment.js";
import { MAX_DRAFT_ATTACHMENTS, MAX_DRAFT_ATTACHMENT_BYTES, getClipboardAttachmentFiles, pastedAttachmentName, readAttachmentFileAsBase64 } from "./clipboard-attachments.js";

export function QuestionAnswerInput({ label, value, onChange, onPaste, disabled, onChoose, submitDisabled, sending }: {
  label: string; value: string; onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void; disabled: boolean;
  onChoose?: () => void; submitDisabled?: boolean; sending?: boolean;
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  return <div className="min-w-0 rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-[5px] focus-within:border-[var(--app-accent)]">
    <QueryTextarea textareaRef={ref} query={null} aria-label={label} rows={2}
    disabled={disabled} value={value} onValueChange={onChange} onPaste={onPaste}
    placeholder="也可以输入自己的答案…"
    className="block w-full resize-y border-0 bg-transparent px-2 py-1 text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] outline-none" />
    {onChoose === undefined ? null : <div className="flex items-center justify-end gap-[5px]">
      <IconButton type="button" size="compact" disabled={disabled} label="添加回答文件或图片" onClick={onChoose}>
        <Paperclip aria-hidden="true" size={15} />
      </IconButton>
      <button type="submit" disabled={submitDisabled} aria-label={sending ? "提交中" : "提交回答"}
        className="inline-flex size-7 items-center justify-center rounded-[var(--app-radius)] border-0 bg-[var(--app-primary-action)] text-[var(--app-primary-action-foreground)] disabled:opacity-40">
        {sending ? <LoaderCircle aria-hidden="true" size={15} className="animate-spin" /> : <Send aria-hidden="true" size={15} />}
      </button>
    </div>}
  </div>;
}

export function useQuestionAttachments(agentClient: AgentClient, conversationId: string) {
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importFiles = async (files: File[] | null): Promise<boolean> => {
    if (busy) return false;
    if (files !== null && (files.length + attachments.length > MAX_DRAFT_ATTACHMENTS || files.some(file => file.size > MAX_DRAFT_ATTACHMENT_BYTES))) {
      setError("最多添加 10 个附件，每个附件不能超过 25 MB。"); return false;
    }
    setBusy(true); setError(null);
    try {
      const previousIds = new Set((await agentClient.listDraftConversationAttachments({ conversationId })).map(item => item.id));
      const collect = (values: ConversationAttachment[]): void => {
        setAttachments(current => [...current, ...values.filter(item => !previousIds.has(item.id) && !current.some(existing => existing.id === item.id))]);
      };
      if (files === null) collect(await agentClient.chooseConversationAttachments({ conversationId }));
      else for (const [index, file] of files.entries()) collect(await agentClient.importConversationAttachmentBytes({
        conversationId, base64: await readAttachmentFileAsBase64(file), name: pastedAttachmentName(file, index),
        ...(file.type.length === 0 ? {} : { mimeType: file.type }),
      }));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加回答附件。"); return false;
    } finally { setBusy(false); }
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>, restoreText: (text: string) => void): void => {
    if (busy) return;
    const files = getClipboardAttachmentFiles(event.clipboardData);
    const text = files.length === 0 ? event.clipboardData.getData("text/plain") : null;
    const textFile = text === null ? null : createPastedTextAttachment(text);
    if (textFile !== null) files.push(textFile);
    if (files.length === 0) return;
    event.preventDefault();
    void importFiles(files).then(imported => { if (!imported && text !== null) restoreText(text); });
  };
  const remove = async (attachment: ConversationAttachment): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await agentClient.removeConversationAttachment({ conversationId, attachmentId: attachment.id });
      setAttachments(current => current.filter(item => item.id !== attachment.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法移除回答附件。"); }
    finally { setBusy(false); }
  };
  return { attachments, busy, error, importFiles, paste, remove };
}

export function QuestionAnswerAttachments({ agentClient, attachments, busy, onRemove, onChoose }: {
  agentClient: AgentClient; attachments: ConversationAttachment[]; busy: boolean;
  onRemove?: (attachment: ConversationAttachment) => void; onChoose?: () => void;
}): ReactElement {
  return <div className="flex min-w-0 flex-wrap items-center gap-[5px]">
    {attachments.map(attachment => <AnswerAttachment key={attachment.id} agentClient={agentClient} attachment={attachment}
      busy={busy} {...(onRemove === undefined ? {} : { onRemove: () => onRemove(attachment) })} />)}
    {onChoose === undefined ? null : <IconButton type="button" size="compact" disabled={busy || attachments.length >= MAX_DRAFT_ATTACHMENTS}
      label={busy ? "正在添加回答附件" : "添加回答文件或图片"} onClick={onChoose}>
      {busy ? <LoaderCircle size={14} /> : <Paperclip size={14} />}
    </IconButton>}
  </div>;
}
function AnswerAttachment({ agentClient, attachment, busy, onRemove }: { agentClient: AgentClient; attachment: ConversationAttachment; busy: boolean; onRemove?: () => void }): ReactElement {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    if (attachment.kind === "image") void agentClient.readConversationAttachmentPreview({ conversationId: attachment.conversationId, attachmentId: attachment.id })
      .then(value => { if (!disposed) setPreview(`data:${value.mimeType};base64,${value.data}`); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [agentClient, attachment]);
  return <span className="inline-flex max-w-full items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 py-1">
    {preview !== null ? <img src={preview} alt={attachment.name} className="h-10 w-10 rounded-[var(--app-radius-small)] object-cover" /> : attachment.kind === "image" ? <Image size={16} /> : <FileText size={16} />}
    <span className="max-w-48 truncate text-[length:var(--app-font-size-auxiliary)]" title={attachment.name}>{attachment.name}</span>
    {onRemove === undefined ? null : <IconButton type="button" size="compact" disabled={busy} label={`移除回答附件 ${attachment.name}`} onClick={onRemove}><X size={12} /></IconButton>}
  </span>;
}
