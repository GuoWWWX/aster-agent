import { z } from "zod";

export const NATIVE_OVERLAY_FRAME_NAME = "aster-native-overlays";
export const NATIVE_OVERLAY_CHANNEL = "native_overlay.set_regions";
export const NATIVE_OVERLAY_BLUR_CHANNEL = "native_overlay.blur";
export const NATIVE_OVERLAY_RESIZE_POINTER_CHANNEL = "native_overlay.resize_pointer";
export const NATIVE_OVERLAY_TOOLTIP_POINTER_CHANNEL = "native_overlay.tooltip_pointer";

const nativeOverlayCoordinateSchema = z.number().int().min(0).max(16_384);

export const nativeOverlayRegionsInputSchema = z.object({
  regions: z.array(z.object({
    x: nativeOverlayCoordinateSchema,
    y: nativeOverlayCoordinateSchema,
    width: nativeOverlayCoordinateSchema,
    height: nativeOverlayCoordinateSchema,
  }).strict()).max(64),
  interactive: z.boolean(),
  resizing: z.boolean().optional(),
  tooltipOnly: z.boolean().optional(),
}).strict();

export const nativeOverlayResizePointerSchema = z.object({
  phase: z.enum(["move", "end"]),
  x: z.number(),
  y: z.number(),
}).strict();

export const nativeOverlayTooltipPointerSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

export type NativeOverlayRegionsInput = z.infer<typeof nativeOverlayRegionsInputSchema>;
export type NativeOverlayResizePointer = z.infer<typeof nativeOverlayResizePointerSchema>;
export type NativeOverlayTooltipPointer = z.infer<typeof nativeOverlayTooltipPointerSchema>;
