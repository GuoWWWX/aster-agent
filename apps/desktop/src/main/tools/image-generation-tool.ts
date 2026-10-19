import { isImageGenerationModel, type ConversationAttachment, type ModelRuntimeStatus } from "@agent/protocol";
import { z } from "zod";
import type { ModelConfiguration, ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { ImageGenerationAdapter, ImageGenerationError, type GeneratedImage } from "../model/image-generation-adapter.js";
import path from "node:path";
import type { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import type { ToolExecution } from "./project-tool-registry.js";

const argumentsSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000).describe("Complete visual brief; describe each reference image's role and required invariants."),
  count: z.number().int().min(1).max(10).default(1).describe("Total number of variants. Call once for the whole batch; the backend fulfills this count and never retries failed requests."),
  referenceAttachmentIds: z.array(z.string().uuid()).max(10).default([]).describe("Image attachment IDs in THIS conversation. Empty for text-to-image; all references go into one edit request."),
  modelId: z.string().trim().min(1).max(200).optional().describe("Exact image model ID only, e.g. gpt-image-2.5-flare. Never prefix a provider ID. Omit to select automatically."),
  providerId: z.string().uuid().optional().describe("Provider UUID, separate from modelId. Omit to prefer the current conversation provider."),
  size: z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]).optional(),
}).strict();

type Credentials = { getStatus(): ModelRuntimeStatus; getConfiguration(providerId?: string, modelId?: string): ModelConfiguration };
export class ImageGenerationTool {
  public constructor(private readonly credentials: Credentials, private readonly attachments: ConversationAttachmentStore, private readonly adapter = new ImageGenerationAdapter()) {}

  public getDefinitions(): ModelToolDefinition[] {
    const models = this.credentials.getStatus().models.filter(isImageGenerationModel);
    const schema = models.length === 0 ? argumentsSchema : argumentsSchema.extend({
      modelId: z.enum([...new Set(models.map(model => model.modelId))]).optional().describe(argumentsSchema.shape.modelId.description ?? "Image model ID"),
      providerId: z.enum([...new Set(models.map(model => model.providerId))]).optional().describe(argumentsSchema.shape.providerId.description ?? "Provider UUID"),
    });
    return [{ name: "generate_images", description: `Generate or edit raster images. Read the imagegen Skill first. Results are saved and displayed automatically. Use attachment IDs for reference images; no raw base64, URLs or filesystem paths. Available choices (providerId and modelId are SEPARATE fields): ${models.length === 0 ? "none configured; add an image model in Settings first" : JSON.stringify(models.map(model => ({ providerId: model.providerId, modelId: model.modelId })))}.`, parameters: modelToolParameters(schema) }];
  }

  public prepare(rawArguments: string, conversationId: string, preferredProviderId: string | null, signal: AbortSignal,
    onImage: (image: GeneratedImage, metadata: { requestedCount: number; modelId: string; providerId: string }) => Promise<ConversationAttachment>): ToolExecution {
    const input = argumentsSchema.parse(parseToolArguments(rawArguments));
    const models = this.credentials.getStatus().models.filter(isImageGenerationModel);
    const candidates = models.filter(model => (input.providerId === undefined || model.providerId === input.providerId) && (input.modelId === undefined || model.modelId === input.modelId));
    const selected = candidates.find(model => model.providerId === (input.providerId ?? preferredProviderId)) ?? candidates[0];
    if (selected === undefined) throw new Error("没有匹配的生图模型。请在设置 → 模型配置中添加模型并标记为生图，然后重新发起请求。");
    return { kind: "approved_action", isError: false, content: JSON.stringify({ ok: true, value: { status: "awaiting_approval" } }), action: {
      permissionTool: "generate_images", pattern: `${selected.modelId}: ${input.count} image(s)`, rejectionMessage: "用户拒绝了本次图片生成。",
      execute: async () => {
        const referenceImages = input.referenceAttachmentIds.map(id => ({ ...this.attachments.readImagePreview(conversationId, id), name: `${id}.png` }));
        const configuration = this.credentials.getConfiguration(selected.providerId, selected.modelId);
        const metadata = { requestedCount: input.count, modelId: selected.modelId, providerId: selected.providerId };
        const images: ConversationAttachment[] = [];
        const value = () => ({ ...metadata, count: images.length, images,
          readPaths: images.map(image => `attachments/${path.basename(this.attachments.resolveThreadLogPaths(image).storedPath)}`) });
        // Some compatible providers ignore n. Fulfill only the remaining requested variants;
        // never replay a failed request or discard completed images.
        while (images.length < input.count) {
          try {
            const generated = await this.adapter.generate(configuration, { ...input, count: input.count - images.length, referenceImages }, signal);
            for (const image of generated) {
              signal.throwIfAborted();
              images.push(await onImage(image, metadata));
            }
          }
          catch (error) {
            if (signal.aborted) throw error;
            const message = error instanceof ImageGenerationError ? error.message : "图片生成或保存未完成，请检查网络和存储空间。未自动重试。";
            return { kind: "completed", isError: true, content: JSON.stringify(images.length === 0 ? { ok: false, error: message }
              : { ok: true, value: { ...value(), notice: `已保留 ${images.length}/${input.count} 张图片；${message}` } }) };
          }
        }
        return { kind: "completed", isError: false, content: JSON.stringify({ ok: true, value: value() }) };
      },
    } };
  }

}
