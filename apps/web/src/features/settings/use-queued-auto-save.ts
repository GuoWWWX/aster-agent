import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveState = "failed" | "idle" | "invalid" | "pending" | "saved" | "saving";

type QueuedAutoSaveOptions<T, Result> = {
  delay?: number;
  onError?: (reason: unknown) => void;
  onSaved?: (value: Result, revision: number) => void;
  revision: number;
  save: (value: T) => Promise<Result>;
  validate: (value: T) => T | null;
  value: T;
};

export function useQueuedAutoSave<T, Result = T>({
  delay = 450,
  onError,
  onSaved,
  revision,
  save,
  validate,
  value,
}: QueuedAutoSaveOptions<T, Result>): { flush: () => void; state: AutoSaveState } {
  const [state, setState] = useState<AutoSaveState>("idle");
  const mountedRef = useRef(true);
  const latestRef = useRef({ revision, value });
  const validateRef = useRef(validate);
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  const onSavedRef = useRef(onSaved);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueuedRevisionRef = useRef(0);
  const completedRevisionRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    latestRef.current = { revision, value };
    validateRef.current = validate;
    saveRef.current = save;
    onErrorRef.current = onError;
    onSavedRef.current = onSaved;
  }, [onError, onSaved, revision, save, validate, value]);

  const enqueue = useCallback((nextRevision: number, nextValue: T): void => {
    if (nextRevision === 0 || nextRevision <= enqueuedRevisionRef.current) return;
    const validValue = validateRef.current(nextValue);
    if (validValue === null) {
      if (mountedRef.current) setState("invalid");
      return;
    }
    enqueuedRevisionRef.current = nextRevision;
    const snapshot = structuredClone(validValue);
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (mountedRef.current) setState("saving");
        const saved = await saveRef.current(snapshot);
        completedRevisionRef.current = nextRevision;
        if (!mountedRef.current) return;
        onSavedRef.current?.(saved, nextRevision);
        setState(
          latestRef.current.revision > nextRevision ? "pending" : "saved",
        );
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current) return;
        setState("failed");
        onErrorRef.current?.(reason);
      });
  }, []);

  const flush = useCallback((): void => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const latest = latestRef.current;
    if (latest.revision <= completedRevisionRef.current) return;
    enqueue(latest.revision, latest.value);
  }, [enqueue]);

  useEffect(() => {
    if (revision === 0) return undefined;
    const latest = latestRef.current;
    if (validateRef.current(latest.value) === null) {
      setState("invalid");
      return undefined;
    }
    setState("pending");
    const timer = window.setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = undefined;
      enqueue(revision, latest.value);
    }, delay);
    timerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = undefined;
    };
  }, [delay, enqueue, revision]);

  useEffect(() => () => {
    flush();
    mountedRef.current = false;
  }, [flush]);

  return { flush, state };
}
