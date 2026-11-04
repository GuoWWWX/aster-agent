export type ComposerReferenceRange = { start: number; end: number };

/** Names can contain spaces; match selected labels, not a generic @word regex. */
export function findComposerReferenceRanges(value: string, labels: readonly string[]): ComposerReferenceRange[] {
  const ranges: ComposerReferenceRange[] = [];
  for (const label of [...new Set(labels)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    let from = 0;
    while (from < value.length) {
      const start = value.indexOf(label, from);
      if (start < 0) break;
      const end = start + label.length;
      from = end;
      if (start > 0 && !/\s/u.test(value[start - 1] ?? "")) continue;
      if (end < value.length && !/[\s，。！？、,.;:!?；：]/u.test(value[end] ?? "")) continue;
      if (ranges.some((range) => start < range.end && end > range.start)) continue;
      ranges.push({ start, end });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export function referenceDeletionRange(
  ranges: readonly ComposerReferenceRange[], start: number, end: number, backward: boolean,
): ComposerReferenceRange | null {
  const selected = ranges.filter((range) => start === end
    ? backward ? start > range.start && start <= range.end : start >= range.start && start < range.end
    : start < range.end && end > range.start);
  if (selected.length === 0) return null;
  return {
    start: Math.min(start, ...selected.map((range) => range.start)),
    end: Math.max(end, ...selected.map((range) => range.end)),
  };
}
