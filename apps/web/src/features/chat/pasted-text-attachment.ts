/** Reuse the normal attachment path for large clipboard text, preserving its bytes. */
export function createPastedTextAttachment(text: string): File | null {
  if (text.length <= 2_000 && text.split(/\r\n|\r|\n/).length <= 20) return null;
  return new File([text], `粘贴文本-${Date.now()}.txt`, { type: "text/plain" });
}
