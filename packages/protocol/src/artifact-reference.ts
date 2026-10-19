import { z } from "zod";

/** Conversation-local presentation identity; unchanged when the conversation is forked. */
export const artifactDisplayRefSchema = z.string().regex(/^artifact:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
