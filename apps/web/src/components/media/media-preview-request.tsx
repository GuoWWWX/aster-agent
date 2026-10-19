import { createContext, useCallback, useContext, type ReactNode } from "react";

export type MediaPreviewImage = { key: string; label: string; load: () => Promise<string> };
export type MediaPreviewRequest = {
  src: string; alt?: string; title?: string; imageKey?: string;
  images?: readonly MediaPreviewImage[];
  loadImages?: (signal?: AbortSignal) => Promise<readonly MediaPreviewImage[]>;
};
export const mediaPreviewRequestEvent = "md-king:open-media-preview";
export function requestMediaPreview(request: MediaPreviewRequest) {
  window.dispatchEvent(new CustomEvent<MediaPreviewRequest>(mediaPreviewRequestEvent, { detail: request }));
}

const GalleryContext = createContext<Pick<MediaPreviewRequest, "images" | "loadImages">>({});
export function MediaPreviewScope({ gallery, children }: {
  gallery: Pick<MediaPreviewRequest, "images" | "loadImages">; children: ReactNode;
}) { return <GalleryContext.Provider value={gallery}>{children}</GalleryContext.Provider>; }

export function useMediaPreview() {
  const gallery = useContext(GalleryContext);
  return useCallback((request: MediaPreviewRequest) => requestMediaPreview({ ...gallery, ...request }), [gallery]);
}
