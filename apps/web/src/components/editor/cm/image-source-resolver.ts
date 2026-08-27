import { resolveBrowserPreviewImage } from "../../../lib/browser-preview-images.js";

export type ImageSourceResolver = (
  path: string,
  sourcePath?: string,
) => string | null | undefined | Promise<string | null | undefined>;

const directImageSource = /^(?:https?:|data:|blob:)/i;

function defaultImageSourceResolver(path: string, sourcePath?: string): string | undefined {
  if (directImageSource.test(path)) return path;
  return resolveBrowserPreviewImage(path, sourcePath);
}

let imageSourceResolver: ImageSourceResolver = defaultImageSourceResolver;

/**
 * The CodeMirror extension is created outside React, so the active host supplies
 * the project-aware resolver. Returning a disposer prevents an unmounted editor
 * from overwriting a newer host's resolver.
 */
export function setImageSourceResolver(resolver: ImageSourceResolver): () => void {
  const previous = imageSourceResolver;
  imageSourceResolver = resolver;
  return () => {
    if (imageSourceResolver === resolver) imageSourceResolver = previous;
  };
}

export async function resolvePreviewImageSource(
  path: string,
  sourcePath?: string,
): Promise<string | null | undefined> {
  return imageSourceResolver(path, sourcePath);
}
