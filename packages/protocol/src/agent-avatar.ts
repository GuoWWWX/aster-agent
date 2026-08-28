import { z } from "zod";

export const AGENT_AVATAR_ICONS = [
  "bot",
  "sparkles",
  "compass",
  "code",
  "hammer",
  "shield",
  "brain",
  "bug",
  "database",
  "flask",
  "palette",
  "rocket",
  "search",
  "terminal",
  "wrench",
  "book",
  "lightbulb",
  "zap",
] as const;

export const agentAvatarIconSchema = z.enum(AGENT_AVATAR_ICONS);

export const agentAvatarSchema = z.discriminatedUnion("kind", [
  z.object({
    icon: agentAvatarIconSchema,
    kind: z.literal("icon"),
  }).strict(),
  z.object({
    dataUrl: z.string().max(3_000_000),
    fileName: z.string().trim().min(1).max(300),
    kind: z.literal("image"),
  }).strict(),
]);

export type AgentAvatarIcon = z.infer<typeof agentAvatarIconSchema>;
export type AgentAvatar = z.infer<typeof agentAvatarSchema>;
