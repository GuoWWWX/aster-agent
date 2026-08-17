import { z } from "zod";

/**
 * Runtime capabilities drive UI availability. The renderer must not infer these
 * from platform strings because browser and desktop hosts can differ by setup.
 */
export const capabilitySetSchema = z
  .object({
    mode: z.enum(["desktop", "web", "mock"]),
    workspace: z.boolean(),
    fileWrite: z.boolean(),
    process: z.boolean(),
    pty: z.boolean(),
    git: z.boolean(),
    managedBrowser: z.boolean(),
    mcp: z.boolean(),
    skills: z.boolean(),
    docxConversion: z.boolean()
  })
  .strict();

export type CapabilitySet = z.infer<typeof capabilitySetSchema>;

