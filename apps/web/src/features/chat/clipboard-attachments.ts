export const MAX_DRAFT_ATTACHMENTS = 10;
export const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1_024 * 1_024;

export function getClipboardAttachmentFiles(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files);
  if (files.length > 0) return files;

  return Array.from(clipboardData.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file === null ? [] : [file];
  });
}

export function pastedAttachmentName(file: File, index: number): string {
  const name = file.name.trim();
  if (name.length > 0) return name;

  const extension = file.type === "image/jpeg"
    ? "jpg"
    : file.type === "image/gif"
      ? "gif"
      : file.type === "image/webp"
        ? "webp"
        : file.type === "image/png"
          ? "png"
          : "bin";
  return `pasted-${file.type.startsWith("image/") ? "image" : "file"}-${index + 1}.${extension}`;
}

export function readAttachmentFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取粘贴的附件"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("无法读取粘贴的附件"));
        return;
      }
      const separatorIndex = reader.result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("无法读取粘贴的附件"));
        return;
      }
      resolve(reader.result.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}
