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
export const computerUseArgumentsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("launch"), applicationId: z.uuid() }).strict(),
  ...(["observe", "screenshot"] as const).map((action) => z.object({
    action: z.literal(action), windowId: z.string().regex(/^\d{1,20}$/u),
  }).strict()),
  z.object({ action: z.literal("click"), windowId: z.string().regex(/^\d{1,20}$/u),
    x: z.number().int().min(0).max(32768), y: z.number().int().min(0).max(32768),
    button: z.enum(["left", "right"]).default("left"),
  }).strict(),
  z.object({ action: z.literal("type"), windowId: z.string().regex(/^\d{1,20}$/u), text: z.string().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("key"), windowId: z.string().regex(/^\d{1,20}$/u),
    key: z.enum(["Enter", "Tab", "Escape", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Left", "Right", "Up", "Down", "Space", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]),
    modifiers: z.array(z.enum(["control", "shift"])).max(2).default([]),
  }).strict(),
  z.object({ action: z.literal("scroll"), windowId: z.string().regex(/^\d{1,20}$/u), delta: z.number().int().min(-10).max(10) }).strict(),
]);
export type ComputerUseArguments = z.infer<typeof computerUseArgumentsSchema>;
