import type { ModelConfiguration, ModelProviderAdapter } from "../model/model-contracts.js";
import { ModelResponseError } from "../model/model-request-error.js";
import { ModelGateway } from "../model/model-gateway.js";
import titlePrompt from "./prompts/conversation-title.md";

/** One small, independent model request; it never runs tools or writes conversation history. */
export class ConversationTitleGenerator {
  private readonly model: ModelGateway;
  public constructor(model: ModelProviderAdapter) { this.model = new ModelGateway(model); }

  public async generate(input: { conversationId: string; content: string; configuration: ModelConfiguration; signal: AbortSignal }): Promise<string> {
    const attempt = async (): Promise<string> => {
      input.signal.throwIfAborted();
      const result = await this.model.completeBackgroundTurn({
        purpose: "title",
        configuration: input.configuration, cacheKey: `aster:title:${input.conversationId}`,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(20_000)]), onTextDelta: () => undefined,
        messages: [
          { role: "system", content: titlePrompt, attachments: [], toolCallId: null, toolCalls: [] },
          { role: "user", content: JSON.stringify({ firstMessage: Array.from(input.content.slice(0, 8000)).slice(0, 4000).join("") }), attachments: [], toolCallId: null, toolCalls: [] },
        ],
      });
      const title = Array.from(result.content.trim().split(/\r?\n/u)[0]?.replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
        .replace(/\.{3,}|…/gu, "").replace(/\s+/gu, " ").trim() ?? "").slice(0, 20).join("").trim();
      if (result.toolCalls.length > 0 || title.length === 0) {
        throw new ModelResponseError(`Conversation naming returned no usable title (finish=${result.finishReason ?? "unknown"}, characters=${title.length}, tools=${result.toolCalls.length}).`);
      }
      return title;
    };
    try { return await attempt(); }
    catch { input.signal.throwIfAborted(); return attempt(); }
  }
}
