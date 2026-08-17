import { z } from "zod";

/**
 * Window state is a snapshot, not a command acknowledgement. It allows the
 * title bar to render immediately without direct Electron access.
 */
export const windowStateSchema = z
  .object({
    isFocused: z.boolean(),
    isMaximized: z.boolean(),
    isFullScreen: z.boolean()
  })
  .strict();

export type WindowState = z.infer<typeof windowStateSchema>;

