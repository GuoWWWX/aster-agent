import type { ManagedBrowserBoundsInput } from "@agent/protocol";

type ManagedBrowserBoundsDispatcher = {
  push: (input: ManagedBrowserBoundsInput) => void;
  stop: () => void;
  pause: (paused: boolean) => void;
};

function managedBrowserBoundsKey(input: ManagedBrowserBoundsInput): string {
  return `${input.sessionId}:${Number(input.visible)}:${input.x}:${input.y}:${input.width}:${input.height}`;
}

/** Keeps native-view IPC bounded to the newest renderer layout while a divider is moving. */
export function createManagedBrowserBoundsDispatcher(
  dispatch: (input: ManagedBrowserBoundsInput) => Promise<void>,
): ManagedBrowserBoundsDispatcher {
  let completedKey: string | null = null;
  let inFlight = false;
  let pending: ManagedBrowserBoundsInput | null = null;
  let stopped = false;
  let paused = false;

  const drain = (): void => {
    if (stopped || paused || inFlight || pending === null) return;
    const next = pending;
    const nextKey = managedBrowserBoundsKey(next);
    pending = null;
    if (nextKey === completedKey) return;
    inFlight = true;
    void dispatch(next).then(() => {
      completedKey = nextKey;
    }).catch(() => undefined).finally(() => {
      inFlight = false;
      drain();
    });
  };

  return {
    push(input) {
      if (stopped || paused) return;
      pending = input;
      drain();
    },
    stop() {
      stopped = true;
      pending = null;
    },
    pause(value) {
      paused = value;
      pending = null;
      completedKey = null;
    },
  };
}
