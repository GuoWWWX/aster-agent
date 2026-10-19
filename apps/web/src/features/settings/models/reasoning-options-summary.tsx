import { useCallback, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { type ModelReasoningOption, modelReasoningOptionKey } from "@agent/protocol";
import { reasoningOptionLabel } from "../model-reasoning-options.js";

export function ReasoningOptionsSummary({
  options,
}: {
  options: readonly ModelReasoningOption[];
}): ReactElement {
  const valueRef = useRef<HTMLSpanElement>(null);
  const tagMeasurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const overflowMeasurementRefs = useRef(new Map<number, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState(options.length);

  const recalculateVisibleCount = useCallback((): void => {
    const valueElement = valueRef.current;
    if (valueElement === null || options.length === 0) return;

    const availableWidth = valueElement.getBoundingClientRect().width;
    const tagWidths = options.map((_, index) =>
      tagMeasurementRefs.current.get(index)?.getBoundingClientRect().width ?? 0,
    );
    if (availableWidth === 0 || tagWidths.some((width) => width === 0)) return;

    const styles = window.getComputedStyle(valueElement);
    const gap = Number.parseFloat(styles.columnGap) || Number.parseFloat(styles.gap) || 0;
    let nextVisibleCount = 0;

    for (let count = options.length; count >= 0; count -= 1) {
      const hiddenCount = options.length - count;
      const widths = tagWidths.slice(0, count);
      if (hiddenCount > 0) {
        const overflowWidth = overflowMeasurementRefs.current
          .get(hiddenCount)
          ?.getBoundingClientRect().width ?? 0;
        if (overflowWidth === 0) continue;
        widths.push(overflowWidth);
      }
      const requiredWidth = widths.reduce((total, width) => total + width, 0)
        + Math.max(0, widths.length - 1) * gap;
      if (requiredWidth <= availableWidth + 0.5) {
        nextVisibleCount = count;
        break;
      }
    }

    setVisibleCount((current) => current === nextVisibleCount ? current : nextVisibleCount);
  }, [options]);

  useLayoutEffect(() => {
    recalculateVisibleCount();
    const valueElement = valueRef.current;
    if (valueElement === null || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(recalculateVisibleCount);
    observer.observe(valueElement);
    return () => observer.disconnect();
  }, [recalculateVisibleCount]);

  if (options.length === 0) {
    return (
      <span
        ref={valueRef}
        className="settings-model-reasoning-button__value"
        data-empty="true"
      >
        <span className="settings-model-reasoning-button__placeholder">自动</span>
      </span>
    );
  }

  const displayedCount = Math.min(visibleCount, options.length);
  const hiddenCount = options.length - displayedCount;
  const summary = options.map(reasoningOptionLabel).join("，");

  return (
    <>
      <span
        ref={valueRef}
        className="settings-model-reasoning-button__value"
        title={summary}
      >
        {options.slice(0, displayedCount).map((option) => (
          <span
            key={modelReasoningOptionKey(option)}
            className="settings-model-reasoning-button__tag"
            title={reasoningOptionLabel(option)}
          >
            {reasoningOptionLabel(option)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="settings-model-reasoning-button__more">+{hiddenCount}</span>
        ) : null}
      </span>
      <span aria-hidden="true" className="settings-model-reasoning-button__measure">
        {options.map((option, index) => (
          <span
            key={modelReasoningOptionKey(option)}
            ref={(element) => {
              if (element === null) tagMeasurementRefs.current.delete(index);
              else tagMeasurementRefs.current.set(index, element);
            }}
            className="settings-model-reasoning-button__tag"
          >
            {reasoningOptionLabel(option)}
          </span>
        ))}
        {options.map((_, index) => {
          const count = options.length - index;
          return (
            <span
              key={count}
              ref={(element) => {
                if (element === null) overflowMeasurementRefs.current.delete(count);
                else overflowMeasurementRefs.current.set(count, element);
              }}
              className="settings-model-reasoning-button__more"
            >
              +{count}
            </span>
          );
        })}
      </span>
    </>
  );
}
