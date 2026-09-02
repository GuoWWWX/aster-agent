const captionAttribute = /\bcaption\s*=\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s}]+))/i;
const boldCaption = /^\s*\*\*([^\r\n]+?)\*\*\s*$/;

/** 读取 ```mermaid {caption="..."} 中的原生图题。 */
export function mermaidFenceCaption(info: string | undefined) {
  const match = info?.match(captionAttribute);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value) return undefined;
  const caption = value.replace(/\\([\\"'])/g, "$1").trim();
  return caption || undefined;
}

/** 用户侧题注只接受与目标块紧邻的整行加粗。 */
export function markdownCaptionText(source: string | undefined) {
  return source?.match(boldCaption)?.[1]?.trim() || undefined;
}
