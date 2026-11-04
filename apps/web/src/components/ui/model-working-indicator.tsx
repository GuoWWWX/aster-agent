import { useEffect, useRef, type ComponentProps, type CSSProperties, type ReactElement } from "react";
import { cn } from "../../lib/cn.js";
import { subscribeModelWorking, type ModelWorkPhase } from "./model-working-motion.js";
export type { ModelWorkPhase } from "./model-working-motion.js";

export function ModelWorkingIndicator({ phase = "thinking", size = 16, className, style, ...props }: ComponentProps<"span"> & {
  phase?: ModelWorkPhase;
  size?: number;
}): ReactElement {
  const element = useRef<HTMLSpanElement>(null);
  const subscription = useRef<ReturnType<typeof subscribeModelWorking> | null>(null);
  useEffect(() => {
    if (element.current === null) return;
    const current = subscribeModelWorking(element.current);
    subscription.current = current;
    return () => { current.dispose(); subscription.current = null; };
  }, []);
  useEffect(() => { subscription.current?.wake(); }, [phase, size]);
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
  const dotStyle: CSSProperties = { width: size * .23, height: size * .23, transform: "translate(-50%, -50%)" };
  return <span ref={element} aria-hidden={labelled ? undefined : true} role={labelled ? "status" : undefined} {...props}
    data-model-working data-phase={phase} data-size={size}
    className={cn("relative inline-block shrink-0 align-middle", className)} style={{ width: size * 1.5, height: size, ...style }}>
    {[0, 1, 2].map(index => <span key={index} aria-hidden="true" className="absolute left-1/2 top-1/2 block rounded-full bg-current" style={dotStyle} />)}
  </span>;
}
