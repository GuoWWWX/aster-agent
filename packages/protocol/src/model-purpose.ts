/** Explicit configuration wins; known image-only model families remain safe for old configurations. */
export function isImageGenerationModel(model: { modelId: string; modelType?: "chat" | "image" | undefined }): boolean {
  return model.modelType === "image" || (model.modelType === undefined && /^(?:gpt-image(?:-|$)|dall-e(?:-|$)|imagen(?:-|$)|flux(?:[.-]|$)|seedream(?:-|$))/iu.test(model.modelId));
}
