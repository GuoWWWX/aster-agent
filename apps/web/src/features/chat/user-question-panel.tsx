import { ChevronDown, ChevronUp, MessageCircleQuestion, Send } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { UserQuestion } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";

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
        const bounds = form?.getBoundingClientRect();
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
  return <div ref={panel} className="mb-2 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-[length:var(--app-font-size-body)] hover:bg-[var(--app-hover)]">
      <MessageCircleQuestion aria-hidden="true" size={16} className="text-[var(--app-accent)]" /><strong className="flex-1">需要你的回答{pending.length > 1 ? ` · ${pending.length}` : ""}</strong><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{expanded ? "稍后回答" : "展开"}</span>{expanded ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
    </button>
    {error ? <p role="alert" className="m-0 px-3 pb-2 text-[var(--app-destructive)]">{error}</p> : null}
    {expanded ? <div className="max-h-[38vh] overflow-auto px-3 pb-3">{pending.map((question) => <QuestionAnswer key={question.id} question={question} agentClient={agentClient} onAnswered={(value) => setQuestions((current) => current.map((item) => item.id === value.id ? value : item))} />)}</div> : null}
  </div>;
}

function QuestionAnswer({ question, agentClient, onAnswered }: { question: UserQuestion; agentClient: AgentClient; onAnswered: (value: UserQuestion) => void }): ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>(question.answers ?? {});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = question.status === "answered";
  return <form data-question-id={question.id} className="space-y-3 border-t border-[var(--app-border)] pt-3" onSubmit={(event) => {
    event.preventDefault(); setSending(true); setError(null);
    void agentClient.answerUserQuestion({ questionId: question.id, answers: submitted ? question.answers ?? {} : answers }).then(onAnswered).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法提交回答。")).finally(() => setSending(false));
  }}>
    {question.conversationId !== question.displayConversationId ? <p className="m-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">来自 {question.sourceTitle}</p> : null}
    {question.questions.map((prompt) => <fieldset key={prompt.id} disabled={sending || submitted} className="m-0 min-w-0 space-y-2 border-0 p-0">
      <legend className="font-medium">{prompt.title}</legend><p className="m-0 whitespace-pre-wrap text-[length:var(--app-font-size-body)]">{prompt.question}</p>
      {prompt.options.length > 0 ? <div className="flex flex-wrap gap-2">{prompt.options.map((option) => <button key={option.label} type="button" aria-pressed={answers[prompt.id] === option.label} title={option.description} onClick={() => setAnswers((current) => ({ ...current, [prompt.id]: option.label }))} className={`rounded-md border px-3 py-1.5 text-left text-[length:var(--app-font-size-body)] ${answers[prompt.id] === option.label ? "border-[var(--app-accent)] bg-[var(--app-selection)] text-[var(--app-accent)]" : "border-[var(--app-border)] bg-transparent hover:bg-[var(--app-hover)]"}`}>{option.label}{option.description ? <span className="mt-0.5 block text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{option.description}</span> : null}</button>)}</div> : null}
      <textarea aria-label={`${prompt.title}的回答`} rows={2} placeholder={prompt.options.length > 0 ? "选择选项，或输入你的回答…" : "输入你的回答…"} value={answers[prompt.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [prompt.id]: event.target.value }))} className="w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2.5 py-2 text-[length:var(--app-font-size-body)] outline-none focus:border-[var(--app-accent)]" />
    </fieldset>)}
    <div className="flex items-center justify-between gap-3"><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{submitted ? "回答已保存，等待送达" : "提交后，代理将继续处理"}</span><button type="submit" disabled={sending || (!submitted && question.questions.some((prompt) => !answers[prompt.id]?.trim()))} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--app-primary-action)] px-3 py-1.5 text-[length:var(--app-font-size-body)] text-[var(--app-primary-action-foreground)] disabled:opacity-40"><Send aria-hidden="true" size={13} />{sending ? "提交中…" : submitted ? "重试送达" : "提交回答"}</button></div>
    {error ? <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}</p> : null}
  </form>;
}
