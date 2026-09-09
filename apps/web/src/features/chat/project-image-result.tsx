import { useEffect, useState } from "react";
import { readProjectPreviewImageInputSchema } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { requestMediaPreview } from "../../components/media/image-viewer.js";

function parseImage(payload: string) {
  const result: unknown = JSON.parse(payload);
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true
    || !("value" in result) || typeof result.value !== "object" || result.value === null
    || !("image" in result.value) || typeof result.value.image !== "object" || result.value.image === null
    || !("projectId" in result.value.image) || !("path" in result.value.image)) throw new Error("Invalid image result");
  return readProjectPreviewImageInputSchema.parse({
    projectId: result.value.image.projectId, path: result.value.image.path, sourcePath: result.value.image.path,
  });
}

export function ProjectImageResult({ agentClient, payload }: { agentClient: AgentClient; payload: string }) {
  const [preview, setPreview] = useState<{ payload: string; url: string | null; error: boolean } | null>(null);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const image = parseImage(payload);
        const result = await agentClient.readProjectPreviewImage({
          projectId: image.projectId, sourcePath: image.path, path: image.path.split("/").at(-1) ?? image.path,
        });
        if (!disposed) setPreview({ payload, url: `data:${result.mimeType};base64,${result.data}`, error: false });
      } catch {
        if (!disposed) setPreview({ payload, url: null, error: true });
      }
    };
    void load();
    return () => { disposed = true; };
  }, [agentClient, payload]);
  let imagePath: string;
  try { imagePath = parseImage(payload).path; }
  catch { return <p role="alert">图片结果无效</p>; }
  const current = preview?.payload === payload ? preview : null;
  const url = current?.url;
  return <div className="flex min-w-0 flex-col items-start gap-1">
    {url == null ? <p className="text-[var(--app-muted-foreground)]" role={current?.error ? "alert" : "status"}>
      {current?.error ? "图片无法加载，文件可能已移动或删除" : "正在读取图片…"}
    </p> : <span className="conversation-attachment conversation-attachment--image-preview"><button type="button" aria-label={`预览图片 ${imagePath}`} title="预览图片"
      className="conversation-attachment__image-button"
      onClick={() => requestMediaPreview({ src: url, title: imagePath, alt: imagePath })}>
      <img src={url} alt={imagePath} />
    </button></span>}
  </div>;
}
