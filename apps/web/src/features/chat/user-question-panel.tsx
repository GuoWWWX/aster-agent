import { Check, ChevronDown, ChevronUp, Circle, MessageCircleQuestion, Send } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { UserQuestion } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { QuestionAnswerInput, QuestionAnswerAttachments, useQuestionAttachments } from "./question-answer-input.js";

export function UserQuestionPanel({ agentClient, conversationId, active }: { agentClient: AgentClient; conversationId: string; active: boolean }): ReactElement | null {
  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    void agentClient.listUserQuestions({ conversationId }).then((values) => { if (!disposed) setQuestions((current) => [...current, ...values.filter((value) => !current.some((item) => item.id === value.id))]); }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "无法读取提问。"); });
    const unsubscribe = agentClient.onConversationRunEvent((event) => {
      if (event.type !== "user_question.updated" || (event.question.conversationId !== conversationId && event.question.displayConversationId !== conversationId)) return;
      setQuestions((current) => [event.question, ...current.filter((question) => question.id !== event.question.id)]);
      if (event.reason === "created") setExpanded(true);
    });
    return () => { disposed = true; unsubscribe(); };
  }, [agentClient, conversationId]);
  const pending = questions.filter((question) => question.status === "pending" || (question.status === "answered" && !question.deliveryComplete));
  useEffect(() => {
    const element = panel.current;
    if (!active || !expanded || !element) return;
    let disposed = false;
    const markViewed = (): void => {
      if (disposed || document.visibilityState !== "visible" || !document.hasFocus()) return;
      for (const question of pending) {
        if (question.viewed) continue;
        const form = element.querySelector<HTMLElement>(`[data-question-id="${question.id}"]`);
        const bounds = form?.querySelector("[data-user-question-prompt]")?.getBoundingClientRect();
        const viewport = form?.parentElement?.getBoundingClientRect();
        if (!bounds || !viewport || bounds.height === 0 || bounds.top < Math.max(0, viewport.top) || bounds.bottom > Math.min(window.innerHeight, viewport.bottom)) continue;
        void agentClient.markUserQuestionViewed({ questionId: question.id }).then((value) => {
          if (!disposed) setQuestions((current) => current.map((item) => item.id === value.id && item.status === "pending" ? value : item));
        }).catch(() => undefined);
      }
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(markViewed);
    observer?.observe(element); markViewed(); element.addEventListener("scroll", markViewed, true);
    window.addEventListener("focus", markViewed); document.addEventListener("visibilitychange", markViewed);
    return () => { disposed = true; observer?.disconnect(); element.removeEventListener("scroll", markViewed, true); window.removeEventListener("focus", markViewed); document.removeEventListener("visibilitychange", markViewed); };
  }, [active, agentClient, expanded, pending]);
  if (pending.length === 0 && error === null) return null;
  return <div ref={panel} className="mx-auto mb-[5px] w-[min(var(--conversation-content-max-width,720px),calc(100%_-_32px))] min-w-0 overflow-hidden rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]" data-user-question-panel>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-[length:var(--app-font-size-body)] hover:bg-[var(--app-hover)]">
      <MessageCircleQuestion aria-hidden="true" size={16} className="text-[var(--app-accent)]" /><strong className="flex-1">需要你的回答{pending.length > 1 ? ` · ${pending.length}` : ""}</strong><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{expanded ? "稍后回答" : "展开"}</span>{expanded ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
    </button>
    {error ? <p role="alert" className="m-0 px-3 pb-2 text-[var(--app-destructive)]">{error}</p> : null}
    <div hidden={!expanded} className="max-h-[55vh] overflow-auto px-3 pb-3">{pending.map((question) => <QuestionAnswer key={question.id} question={question} agentClient={agentClient} onAnswered={(value) => setQuestions((current) => current.map((item) => item.id === value.id ? value : item))} />)}</div>
  </div>;
}

function QuestionAnswer({ question, agentClient, onAnswered }: { question: UserQuestion; agentClient: AgentClient; onAnswered: (value: UserQuestion) => void }): ReactElement {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>(question.answers ?? {});
  const attachmentState = useQuestionAttachments(agentClient, question.conversationId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = question.status === "answered";
  const answers = Object.fromEntries(question.questions.map(prompt => [prompt.id,
    texts[prompt.id]?.trim() || choices[prompt.id] || (question.questions.length === 1 && attachmentState.attachments.length > 0 ? "请参考回答附件。" : "")]));
  const changeText = (id: string, value: string): void => {
    setTexts(current => ({ ...current, [id]: value }));
    setChoices(current => ({ ...current, [id]: "" }));
  };
  return <form data-question-id={question.id} className="space-y-[5px] border-t border-[var(--app-border)] pt-3" onSubmit={(event) => {
    event.preventDefault();
    if (sending || attachmentState.busy || (!submitted && question.questions.some(prompt => !answers[prompt.id]?.trim()))) return;
    setSending(true); setError(null);
    const attachmentIds = submitted ? question.answerAttachmentIds ?? [] : attachmentState.attachments.map(attachment => attachment.id);
    void agentClient.answerUserQuestion({ questionId: question.id, answers: submitted ? question.answers ?? {} : answers,
      ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
    }).then(onAnswered).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法提交回答。")).finally(() => setSending(false));
  }}>
    {question.conversationId !== question.displayConversationId ? <p className="m-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">来自 {question.sourceTitle}</p> : null}
    {question.questions.map((prompt) => <fieldset key={prompt.id} disabled={sending || submitted || attachmentState.busy} className="m-0 min-w-0 space-y-[5px] border-0 p-0">
      <legend className="sr-only">{prompt.title}</legend><p data-user-question-prompt className="m-0 break-words text-[length:var(--app-font-size-body)] font-medium">{prompt.question}</p>
      {prompt.options.length > 0 ? <div className="grid min-w-0 grid-cols-1 gap-[5px]">{prompt.options.map((option) => {
        const selected = choices[prompt.id] === option.label;
        const recommended = option.recommended === true || /\((?:Recommended)\)|[（(]推荐[)）]/i.test(option.label);
        return <button key={option.label} type="button" aria-pressed={selected} onClick={() => {
          setChoices(current => ({ ...current, [prompt.id]: selected ? "" : option.label }));
          setTexts(current => ({ ...current, [prompt.id]: "" }));
        }} className={`flex w-full min-w-0 items-start gap-2 rounded-[var(--app-radius)] border px-3 py-1.5 text-left text-[length:var(--app-font-size-body)] ${selected ? "border-[var(--app-accent)] bg-[var(--app-selection)]" : "border-[var(--app-border)] bg-transparent hover:bg-[var(--app-hover)]"}`}>
          {selected ? <Check aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-[var(--app-accent)]" /> : <Circle aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-[var(--app-muted-foreground)]" />}
          <span className="min-w-0 flex-1 break-words"><span className="font-medium">{option.label}</span>
            {option.description ? <><span className="text-[var(--app-muted-foreground)]"> · </span><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{option.description}</span></> : null}
          </span>
          {recommended ? <span className="shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-status-info-bg)] px-1.5 py-0.5 text-[length:var(--app-font-size-caption)] text-[var(--app-status-info-fg)]">AI 推荐</span> : null}
        </button>;
      })}</div> : null}
      <QuestionAnswerInput label={`${prompt.title}的回答`} disabled={sending || submitted || attachmentState.busy}
        value={submitted ? question.answers?.[prompt.id] ?? "" : texts[prompt.id] ?? ""}
        onChange={value => changeText(prompt.id, value)}
        onPaste={event => attachmentState.paste(event, text => changeText(prompt.id, `${texts[prompt.id] ?? ""}${text}`))} />
    </fieldset>)}
    <QuestionAnswerAttachments agentClient={agentClient} attachments={attachmentState.attachments} busy={sending || attachmentState.busy}
      {...(submitted ? {} : { onRemove: (attachment) => { void attachmentState.remove(attachment); }, onChoose: () => { void attachmentState.importFiles(null); } })} />
    <div className="flex items-center justify-between gap-3"><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{submitted ? "回答已保存，等待送达" : "提交后，代理将继续处理"}</span><button type="submit" disabled={sending || attachmentState.busy || (!submitted && question.questions.some((prompt) => !answers[prompt.id]?.trim()))} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--app-radius)] bg-[var(--app-primary-action)] px-3 py-1.5 text-[length:var(--app-font-size-body)] text-[var(--app-primary-action-foreground)] disabled:opacity-40"><Send aria-hidden="true" size={13} />{sending ? "提交中…" : submitted ? "重试送达" : "提交回答"}</button></div>
    {attachmentState.error ? <p role="alert" className="m-0 text-[var(--app-destructive)]">{attachmentState.error}</p> : null}
    {error ? <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}</p> : null}
  </form>;
}
