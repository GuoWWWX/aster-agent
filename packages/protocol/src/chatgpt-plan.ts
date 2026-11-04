import { z } from "zod";

export const chatGptConnectionSchema = z.object({
  providerId: z.string().uuid(),
  label: z.string().min(1).max(100),
  email: z.string().max(1000).nullable(),
  signedIn: z.boolean(),
  connected: z.boolean(),
}).strict();
export const chatGptConnectionListSchema = z.array(chatGptConnectionSchema).max(100);
export const chatGptConnectResultSchema = chatGptConnectionSchema.pick({ providerId: true, email: true }).extend({ planEnabled: z.boolean() });
export const chatGptProviderInputSchema = z.object({ providerId: z.string().uuid() }).strict();
export const chatGptConnectInputSchema = z.object({ providerId: z.string().uuid().optional() }).strict();
export type ChatGptConnection = z.infer<typeof chatGptConnectionSchema>;
export type ChatGptConnectResult = z.infer<typeof chatGptConnectResultSchema>;
