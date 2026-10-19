import { z } from "zod";

export const computerApplicationSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  executablePath: z.string().min(1).max(4096)
    .refine((value) => /^[a-z]:\\/iu.test(value) && /\.exe$/iu.test(value) && !/[\r\n\0]/u.test(value), "请选择本机的 .exe 文件。"),
  enabled: z.boolean(),
}).strict();
export const computerUseConfigurationSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  administrator: z.boolean(),
  accessMode: z.enum(["ask", "all"]).default("ask"),
  applications: z.array(computerApplicationSchema).max(100),
  blockedApplications: z.array(computerApplicationSchema).max(100).default([]),
}).strict().superRefine((value, context) => {
  for (const list of ["applications", "blockedApplications"] as const) {
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const application of value[list]) {
      const canonical = application.executablePath.toLowerCase();
      if (ids.has(application.id) || paths.has(canonical)) {
        context.addIssue({ code: "custom", path: [list], message: "软件不可重复添加。" });
      }
      ids.add(application.id); paths.add(canonical);
    }
  }
});
export type ComputerUseConfiguration = z.infer<typeof computerUseConfigurationSchema>;
export type ComputerApplication = z.infer<typeof computerApplicationSchema>;
/** Preserve host-approved grants while applying explicit edits from a settings snapshot. */
export function mergeComputerApplicationGrants(baseline: ComputerApplication[], requested: ComputerApplication[], latest: ComputerApplication[]): ComputerApplication[] {
  const original = new Map(baseline.map((application) => [application.id, application]));
  const server = new Map(latest.map((application) => [application.id, application]));
  const merged = requested.flatMap((application) => {
    if (original.has(application.id) && JSON.stringify(original.get(application.id)) === JSON.stringify(application)) {
      const saved = server.get(application.id); return saved === undefined ? [] : [saved];
    }
    return [application];
  });
  for (const application of latest) {
    if (!original.has(application.id) && !merged.some((value) => value.id === application.id || value.executablePath.toLowerCase() === application.executablePath.toLowerCase())) merged.push(application);
  }
  return merged;
}
export const saveComputerUseConfigurationArgumentsSchema = z.tuple([z.union([
  computerUseConfigurationSchema,
  z.object({ configuration: computerUseConfigurationSchema, baselineApplications: z.array(computerApplicationSchema).max(100) }).strict(),
])]).transform(([value]) => "configuration" in value ? [value.configuration, value.baselineApplications] as const : [value, undefined] as const);
export const DEFAULT_COMPUTER_USE_CONFIGURATION: ComputerUseConfiguration = {
  version: 1, enabled: false, administrator: false, accessMode: "ask", applications: [], blockedApplications: [],
};
export const computerApplicationIconsSchema = z.record(z.uuid(), z.string().max(300_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u).nullable());
export type ComputerApplicationIcons = z.infer<typeof computerApplicationIconsSchema>;
export const computerUseStatusSchema = z.object({
  supported: z.boolean(),
  running: z.boolean(),
  elevated: z.boolean(),
}).strict();
export type ComputerUseStatus = z.infer<typeof computerUseStatusSchema>;
const windowIdSchema = z.string().regex(/^\d{1,20}$/u);
const coordinateSchema = z.number().int().min(0).max(32768);
const pointSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict();
const buttonSchema = z.enum(["left", "right", "middle"]);
const keySchema = z.enum([
  "Enter", "Tab", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "Left", "Right", "Up", "Down", "Space", "CapsLock", "NumLock", "ScrollLock", "PrintScreen", "Pause",
  "Semicolon", "Equal", "Comma", "Minus", "Period", "Slash", "Backquote", "BracketLeft", "Backslash", "BracketRight", "Quote",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
]);
const modifiersSchema = z.array(z.enum(["control", "shift", "alt", "win"])).max(4)
  .refine((values) => new Set(values).size === values.length, "修饰键不能重复。").default([]);
/** A bounded input operation; no held input state can escape an operation or sequence. */
export const computerInputStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("focus") }).strict(),
  z.object({ action: z.literal("move"), ...pointSchema.shape }).strict(),
  z.object({ action: z.literal("click"), ...pointSchema.shape, button: buttonSchema.default("left"), count: z.number().int().min(1).max(3).default(1) }).strict(),
  z.object({ action: z.literal("drag"), path: z.array(pointSchema).min(2).max(256),
    button: buttonSchema.default("left"), durationMs: z.number().int().min(100).max(5000).default(500) }).strict(),
  z.object({ action: z.literal("type"), text: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("paste"), text: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("key"), key: keySchema, modifiers: modifiersSchema }).strict(),
  z.object({ action: z.literal("scroll"), x: coordinateSchema.optional(), y: coordinateSchema.optional(),
    axis: z.enum(["vertical", "horizontal"]).default("vertical"), delta: z.number().int().min(-10).max(10).refine((value) => value !== 0) }).strict(),
]);
const inputActions = computerInputStepSchema.options.map((schema) => schema.extend({ windowId: windowIdSchema }));
export const computerUseArgumentsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("stop") }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("launch"), applicationId: z.uuid() }).strict(),
  ...(["observe", "screenshot"] as const).map((action) => z.object({
    action: z.literal(action), windowId: windowIdSchema,
  }).strict()),
  ...inputActions,
  z.object({ action: z.literal("sequence"), windowId: windowIdSchema, steps: z.array(computerInputStepSchema).min(1).max(30) }).strict(),
]).superRefine((command, context) => {
  const steps = command.action === "sequence" ? command.steps : [command];
  let duration = 0, characters = 0;
  for (const step of steps) {
    if (step.action === "scroll" && ((step.x === undefined) !== (step.y === undefined))) {
      context.addIssue({ code: "custom", message: "滚动位置必须同时提供 x 和 y，或都省略以使用鼠标当前位置。" });
    }
    if (step.action === "drag") duration += step.durationMs;
    if (step.action === "type" || step.action === "paste") characters += step.text.length;
  }
  if (duration > 10_000 || characters > 8000) context.addIssue({ code: "custom", message: "动作序列最多拖动 10 秒、输入 8000 字符，请拆分执行。" });
});
export type ComputerUseArguments = z.infer<typeof computerUseArgumentsSchema>;
