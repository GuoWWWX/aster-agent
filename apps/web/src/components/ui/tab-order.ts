export function appendNewTabIds(order: string[], ids: readonly string[]): string[] {
  const known = new Set(order);
  const added: string[] = [];
  for (const id of ids) {
    if (known.has(id)) continue;
    known.add(id);
    added.push(id);
  }
  return added.length === 0 ? order : [...order, ...added];
}

export function moveTabId(
  order: string[], source: string, target: string, side: "before" | "after",
): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + (side === "after" ? 1 : 0), 0, source);
  return next;
}
