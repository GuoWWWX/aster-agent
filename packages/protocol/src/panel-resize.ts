import { z } from "zod";

const coordinate = z.number().finite().min(-16_384).max(16_384);
const size = z.number().int().min(0).max(16_384);
export const panelDragSchema = z.object({
  origin: coordinate, base: size, size, min: size, max: size,
  threshold: size, collapsed: z.boolean(), collapsible: z.boolean(),
  direction: z.enum(["from-start", "from-end"]),
}).strict().refine(value => value.min <= value.max);
export type PanelDrag = z.infer<typeof panelDragSchema>;

/** Both input owners advance the same snapshot, including collapse/reopen rebasing. */
export function advancePanelDrag(drag: PanelDrag, x: number): PanelDrag {
  const next = drag.base + (x - drag.origin) * (drag.direction === "from-start" ? 1 : -1);
  if (drag.collapsible && !drag.collapsed && next <= drag.min - drag.threshold) {
    return { ...drag, size: drag.min, collapsed: true };
  }
  if (drag.collapsible && drag.collapsed && next >= drag.min + drag.threshold) {
    return { ...drag, origin: x, base: drag.min, size: drag.min, collapsed: false };
  }
  return drag.collapsed ? drag : { ...drag, size: Math.min(drag.max, Math.max(drag.min, Math.round(next))) };
}

export const managedBrowserResizeSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("start"), id: z.uuid(), drag: panelDragSchema,
    rawX: coordinate, rawRight: coordinate, viewportWidth: size }).strict(),
  z.object({ phase: z.enum(["move", "end"]), id: z.uuid(), pointerX: coordinate }).strict(),
]);

/** The right edge is fixed: only the left edge moves with the sidebar's width. */
export function directBrowserHorizontalBounds(rawX: number, rawRight: number, delta: number, viewportWidth: number): { x: number; width: number } {
  const x = Math.max(0, Math.min(viewportWidth, Math.round(rawX - delta)));
  return { x, width: Math.max(0, Math.min(viewportWidth, Math.round(rawRight)) - x) };
}
