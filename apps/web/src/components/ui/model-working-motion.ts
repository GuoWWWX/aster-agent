export type ModelWorkPhase = "thinking" | "searching" | "executing" | "writing" | "waiting" | "done";
type Pose = { x: number; y: number; z: number; opacity: number; scale: number };

function thinkingShape(mode: number, time: number, index: number) {
  const theta = time * 1.7 + index * Math.PI * 2 / 3;
  switch (mode) {
    case 0: return { x: Math.sin(theta) * .92, y: Math.sin(theta * 2) * .66, z: Math.cos(theta) };
    case 1: {
      const radius = .62 + .22 * Math.sin(time * .8);
      return { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, z: Math.sin(theta + .7) };
    }
    case 2: return { x: Math.cos(theta), y: Math.sin(theta) * .8, z: Math.sin(theta) };
    default: return { x: Math.sin(theta) * .9, y: Math.cos(theta * 2 + .5) * .55, z: Math.cos(theta) };
  }
}

export function modelWorkingPose(phase: ModelWorkPhase, time: number, index: number): Pose {
  if (phase === "thinking") {
    const part = time / 4.8;
    const mode = Math.floor(part) % 4;
    const blend = Math.max(0, (part % 1 - .75) / .25);
    const weight = blend * blend * (3 - 2 * blend);
    const a = thinkingShape(mode, time, index), b = thinkingShape((mode + 1) % 4, time, index);
    const z = a.z + (b.z - a.z) * weight;
    return { x: a.x + (b.x - a.x) * weight, y: a.y + (b.y - a.y) * weight, z, opacity: .55 + (z + 1) * .22, scale: .82 + (z + 1) * .14 };
  }
  if (phase === "searching") {
    const pulse = Math.pow(Math.max(0, Math.sin(time * 3.5 - index * .85)), 3);
    return { x: (index - 1) * .85, y: -pulse * .17, z: 0, opacity: .32 + .68 * pulse, scale: .85 + .22 * pulse };
  }
  if (phase === "executing") {
    const theta = time * 2 + index * Math.PI * 2 / 3;
    return { x: Math.cos(theta) * .78, y: Math.sin(theta) * .82, z: Math.sin(theta), opacity: .62 + (Math.sin(theta) + 1) * .18, scale: .9 };
  }
  if (phase === "writing") return { x: (index - 1) * .85, y: Math.sin(time * 3.4 - index * .8) * .32, z: 0, opacity: .8, scale: .9 + Math.sin(time * 3.4 - index * .8) * .08 };
  if (phase === "waiting") return { x: (index - 1) * .7, y: 0, z: 0, opacity: .45 + (Math.sin(time * 1.5 + index * .3) + 1) * .2, scale: .82 + Math.sin(time * 1.5) * .07 };
  return { x: (index - 1) * .55, y: 0, z: 0, opacity: .75, scale: .82 };
}

type Target = { element: HTMLElement; dots: HTMLElement[]; poses: Pose[]; visible: boolean };
type Subscription = { dispose: () => void; wake: () => void };
const animators = new WeakMap<Document, ReturnType<typeof createAnimator>>();

/** One clock per document, including native overlay documents; never re-render React per frame. */
function createAnimator(document: Document) {
  const view = document.defaultView!;
  const targets = new Map<HTMLElement, Target>();
  const reduced = view.matchMedia?.("(prefers-reduced-motion: reduce)");
  let frame: number | null = null;
  let previous = 0;
  let time = 0;
  function draw(target: Target, delta: number, still: boolean) {
    const phase = target.element.dataset.phase as ModelWorkPhase;
    const size = Number(target.element.dataset.size);
    const weight = still ? 1 : 1 - Math.exp(-delta * 9);
    target.poses.forEach((pose, index) => {
      const next = modelWorkingPose(still ? "done" : phase, time, index);
      for (const key of ["x", "y", "z", "opacity", "scale"] as const) pose[key] += (next[key] - pose[key]) * weight;
      const dot = target.dots[index]!;
      dot.style.transform = `translate(-50%, -50%) translate3d(${(pose.x * size * .4).toFixed(2)}px, ${(pose.y * size * .25).toFixed(2)}px, 0) scale(${pose.scale.toFixed(3)})`;
      dot.style.opacity = pose.opacity.toFixed(3);
      dot.style.zIndex = String(Math.round((pose.z + 1) * 5));
    });
  }
  function tick(now: number) {
    frame = null;
    if (document.hidden || reduced?.matches) return;
    const delta = previous === 0 ? 1 / 60 : Math.min(.06, (now - previous) / 1000);
    previous = now;
    time += delta;
    let active = false;
    for (const target of targets.values()) {
      if (!target.visible) continue;
      const done = target.element.dataset.phase === "done";
      draw(target, delta, done);
      active ||= !done;
    }
    if (active) frame = view.requestAnimationFrame(tick);
  }
  function wake() {
    if (reduced?.matches || typeof view.requestAnimationFrame !== "function") {
      for (const target of targets.values()) draw(target, 1, true);
      return;
    }
    if (frame === null && !document.hidden && [...targets.values()].some(target => target.visible && target.element.dataset.phase !== "done")) {
      previous = 0;
      frame = view.requestAnimationFrame(tick);
    }
  }
  function visibilityChanged() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    wake();
  }
  const observer = typeof view.IntersectionObserver === "function" ? new view.IntersectionObserver(entries => {
    entries.forEach(entry => { const target = targets.get(entry.target as HTMLElement); if (target) target.visible = entry.isIntersecting; });
    wake();
  }) : null;
  document.addEventListener("visibilitychange", visibilityChanged);
  reduced?.addEventListener("change", visibilityChanged);
  return {
    subscribe(element: HTMLElement): Subscription {
      const target: Target = { element, dots: [...element.children] as HTMLElement[], poses: [0, 1, 2].map(index => modelWorkingPose("done", 0, index)), visible: observer === null };
      targets.set(element, target);
      draw(target, 1, reduced?.matches ?? false);
      observer?.observe(element);
      wake();
      return {
        wake: () => { if (element.dataset.phase === "done") draw(target, 1, true); wake(); },
        dispose: () => {
          observer?.unobserve(element);
          targets.delete(element);
          if (targets.size !== 0) return;
          if (frame !== null) view.cancelAnimationFrame(frame);
          observer?.disconnect();
          document.removeEventListener("visibilitychange", visibilityChanged);
          reduced?.removeEventListener("change", visibilityChanged);
          animators.delete(document);
        },
      };
    },
  };
}

export function subscribeModelWorking(element: HTMLElement): Subscription {
  const document = element.ownerDocument;
  let animator = animators.get(document);
  if (animator === undefined) { animator = createAnimator(document); animators.set(document, animator); }
  return animator.subscribe(element);
}
