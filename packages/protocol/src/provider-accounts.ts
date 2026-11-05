import { z } from "zod";
import { modelRuntimeStatusSchema } from "./conversation.js";

export const accountConnectionSchema = z.object({
  providerId: z.string().uuid(), label: z.string().min(1).max(100), email: z.string().max(1000).nullable(), signedIn: z.boolean(), connected: z.boolean(),
}).strict();
export type AccountConnection = z.infer<typeof accountConnectionSchema>;

const kind = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u);
export const accountProviderSchema = z.object({
  kind, name: z.string().min(1).max(100), signInLabel: z.string().min(1).max(100),
  usageUrl: z.string().url().nullable(),
}).strict();
export const providerAccountRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("providers") }).strict(),
  z.object({ action: z.literal("list"), kind }).strict(),
  z.object({ action: z.literal("connect"), kind, providerId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal("disconnect"), kind, providerId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("sync"), kind, providerId: z.string().uuid() }).strict(),
]);
export const providerAccountResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("providers"), providers: z.array(accountProviderSchema).max(30) }).strict(),
  z.object({ action: z.literal("list"), connections: z.array(accountConnectionSchema).max(100) }).strict(),
  z.object({ action: z.literal("connect"), providerId: z.string().uuid(), email: z.string().max(1000).nullable(), authorized: z.boolean() }).strict(),
  z.object({ action: z.literal("disconnect"), revoked: z.boolean() }).strict(),
  z.object({ action: z.literal("sync"), status: modelRuntimeStatusSchema }).strict(),
]);
export type AccountProvider = z.infer<typeof accountProviderSchema>;
export type ProviderAccountRequest = z.infer<typeof providerAccountRequestSchema>;
export type ProviderAccountResponse = z.infer<typeof providerAccountResponseSchema>;
