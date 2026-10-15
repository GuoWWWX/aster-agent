import { expect, it } from "vitest";
import { managedBrowserBoundsInputSchema, managedBrowserEventSchema } from "./developer-tools.js";
import { advancePanelDrag, directBrowserHorizontalBounds, managedBrowserResizeSchema, type PanelDrag } from "./panel-resize.js";
const drag: PanelDrag = { origin: 500, base: 300, size: 300, min: 220, max: 600,
  threshold: 24, collapsed: false, collapsible: true, direction: "from-end" };
it("uses a shared clamped integer width and rebases after collapse/reopen", () => {
  expect(advancePanelDrag(drag, 460.4).size).toBe(340);
  expect(advancePanelDrag(drag, -500).size).toBe(600);
  const collapsed = advancePanelDrag(drag, 610);
  expect(collapsed.collapsed).toBe(true);
  const reopened = advancePanelDrag(collapsed, 550);
  expect(reopened).toMatchObject({ size: 220, base: 220, origin: 550, collapsed: false });
  expect(advancePanelDrag(reopened, 530).size).toBe(240);
});
it("calculates only the moving edge and clips it to the fixed viewport", () => {
  expect(directBrowserHorizontalBounds(700, 1200, 100, 1200)).toEqual({ x: 600, width: 600 });
  expect(directBrowserHorizontalBounds(700, 1200, 900, 1200)).toEqual({ x: 0, width: 1200 });
  expect(directBrowserHorizontalBounds(-50, 1200, -100, 1200)).toEqual({ x: 50, width: 1150 });
});
it("accepts a bounded strict start snapshot and rejects unbounded or extra input", () => {
  const input = { phase: "start", id: "00000000-0000-4000-8000-000000000001", drag,
    rawX: 700, rawRight: 1200, viewportWidth: 1200 };
  expect(managedBrowserResizeSchema.parse(input)).toEqual(input);
  for (const invalid of [{ ...input, extra: true }, { ...input, rawX: Infinity },
    { ...input, drag: { ...drag, min: 900, max: 200 } }, { ...input, drag: { ...drag, size: -1 } }]) {
    expect(managedBrowserResizeSchema.safeParse(invalid).success).toBe(false);
  }
});
it("validates the existing bounds envelope and native resize event without widening their schemas", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const input = { sessionId: id, x: 700, y: 100, width: 500, height: 600, visible: true,
    resize: { phase: "move", id, pointerX: 600 } };
  expect(managedBrowserBoundsInputSchema.parse(input)).toEqual(input);
  for (const invalid of [{ ...input, resize: { ...input.resize, extra: true } },
    { ...input, resize: { ...input.resize, id: "stale" } },
    { ...input, resize: { ...input.resize, pointerX: Infinity } }]) {
    expect(managedBrowserBoundsInputSchema.safeParse(invalid).success).toBe(false);
  }
  const event = { type: "panelResize", sessionId: id, id, phase: "end", pointerX: 600, size: 520, collapsed: false };
  expect(managedBrowserEventSchema.parse(event)).toEqual(event);
  for (const invalid of [{ ...event, extra: true }, { ...event, size: 0.5 }, { ...event, phase: "start" }]) {
    expect(managedBrowserEventSchema.safeParse(invalid).success).toBe(false);
  }
});
