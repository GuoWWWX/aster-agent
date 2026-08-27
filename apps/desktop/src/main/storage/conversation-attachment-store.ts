import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
  estimateContextTokens,
  type ConversationAttachment
} from "@agent/protocol";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import mammoth from "mammoth";
import { extractText } from "unpdf";

import {
  modelImageAttachmentCaption,
  type ModelMessageAttachment
} from "../model/model-contracts.js";
import type { ProjectRegistry } from "../projects/project-registry.js";
import {
  AgentDatabase,
  type StoredConversationAttachment
} from "./agent-database.js";

const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1_024 * 1_024;
const INLINE_TEXT_CHARACTERS = 48_000;
const INLINE_TEXT_HEAD_CHARACTERS = 36_000;
const INLINE_TEXT_TAIL_CHARACTERS = 12_000;
const IMAGE_CONTEXT_TOKENS_MIN = 1_024;
const IMAGE_CONTEXT_TOKENS_MAX = 8_192;

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".log",
  ".md",
  ".mjs",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);

const TEXT_MIME_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/sql",
  "application/xml",
  "application/x-httpd-php",
  "application/x-sh",
  "application/yaml",
  "image/svg+xml"
]);

const MODEL_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml"
};

type AttachmentSource = Pick<ConversationAttachment, "projectPath" | "source">;

export type ConversationAttachmentBytesInput = {
  bytes: Uint8Array;
  /** A display name only; it is never treated as a filesystem path. */
  name: string;
  /** Browser/clipboard MIME metadata; detected bytes take precedence. */
  mimeType?: string;
};

export class ConversationAttachmentStore {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly projects: ProjectRegistry,
    private readonly rootPath: string
  ) {}

  public async importFiles(
    conversationId: string,
    sourcePaths: readonly string[]
  ): Promise<ConversationAttachment[]> {
    if (sourcePaths.length === 0) return [];
    this.assertCanAddDrafts(conversationId, sourcePaths.length);

    const imported: ConversationAttachment[] = [];
    try {
      for (const sourcePath of sourcePaths) {
        imported.push(await this.importFile(conversationId, sourcePath));
      }
      return imported;
    } catch (error) {
      for (const attachment of imported) {
        await this.removeDraft(conversationId, attachment.id).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Imports a clipboard or drag-and-drop Blob without requiring the renderer
   * to materialize an unmanaged temporary path first.
   */
  public async importBytes(
    conversationId: string,
    input: ConversationAttachmentBytesInput,
  ): Promise<ConversationAttachment> {
    this.assertCanAddDrafts(conversationId, 1);
    if (input.bytes.byteLength === 0) throw new Error("不能添加空附件。");
    if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("单个附件不能超过 25 MB。");
    }
    const name = path.basename(input.name).trim().slice(0, 255);
    if (name.length === 0 || name === "." || name === "..") {
      throw new Error("附件名称无效。");
    }
    const extension = path.extname(name).toLowerCase();
    const detectedType = await fileTypeFromBuffer(input.bytes);
    const declaredMimeType = input.mimeType?.trim().toLowerCase();
    const mimeType = detectedType?.mime
      ?? (declaredMimeType?.includes("/") === true ? declaredMimeType : undefined)
      ?? EXTENSION_MIME_TYPES[extension]
      ?? (TEXT_EXTENSIONS.has(extension) ? "text/plain" : "application/octet-stream");
    const id = randomUUID();
    const directory = path.join(this.rootPath, conversationId);
    await mkdir(directory, { recursive: true });
    const storedPath = path.join(directory, `${id}${extension}`);
    await writeFile(storedPath, input.bytes);
    return this.completeImportedFile({
      conversationId,
      extension,
      id,
      mimeType,
      name,
      sizeBytes: input.bytes.byteLength,
      source: { projectPath: null, source: "upload" },
      storedPath,
    });
  }

  public listDrafts(conversationId: string): ConversationAttachment[] {
    return this.database.listDraftConversationAttachments(conversationId);
  }

  /**
   * Derives managed paths from an immutable Attachment reference during
   * ThreadLog recovery. Paths stay out of JSONL; the store layout is the
   * only location that knows how to resolve them.
   */
  public resolveThreadLogPaths(attachment: ConversationAttachment): {
    extractedTextPath: string | null;
    storedPath: string;
  } {
    const directory = path.join(this.rootPath, attachment.conversationId);
    const extension = path.extname(attachment.name).toLowerCase();
    const storedPath = path.join(directory, `${attachment.id}${extension}`);
    const extractedTextPath = path.join(directory, `${attachment.id}.extracted.txt`);
    return {
      extractedTextPath: attachment.kind === "file" && existsSync(extractedTextPath)
        ? extractedTextPath
        : null,
      storedPath,
    };
  }

  public async removeDraft(conversationId: string, attachmentId: string): Promise<void> {
    const attachment = this.database.removeDraftConversationAttachment(
      conversationId,
      attachmentId
    );
    const filePaths = new Set([
      attachment.storedPath,
      ...(attachment.extractedTextPath === null
        ? []
        : [attachment.extractedTextPath])
    ]);
    await Promise.all([...filePaths].map((filePath) => this.removeFile(filePath)));
  }

  public async deleteUnreferencedConversationFiles(
    conversationIds: readonly string[],
    candidateFiles: readonly string[]
  ): Promise<void> {
    const managedFiles = [...new Set(candidateFiles.map((filePath) => path.resolve(filePath)))];
    if (managedFiles.some((filePath) => !this.isManagedPath(filePath))) {
      throw new Error("Conversation cleanup cannot delete a file outside managed storage.");
    }

    for (const filePath of managedFiles) {
      if (this.database.isConversationAttachmentFileReferencedByActiveConversation(filePath)) {
        continue;
      }
      await this.removeFile(filePath);
    }

    const directories = new Set([
      ...conversationIds.map((conversationId) => path.join(this.rootPath, conversationId)),
      ...managedFiles.map((filePath) => path.dirname(filePath)),
    ]);
    for (const directory of directories) {
      await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") {
          throw error;
        }
      });
    }
  }

  private isManagedPath(filePath: string): boolean {
    const relativePath = path.relative(this.rootPath, path.resolve(filePath));
    return relativePath.length > 0
      && relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath);
  }

  public toModelAttachments(
    conversationId: string,
    attachmentIds: readonly string[],
    includeImageData: boolean
  ): ModelMessageAttachment[] {
    return this.database
      .listConversationAttachmentsByIds(conversationId, attachmentIds)
      .map((attachment) => this.toModelAttachment(attachment, includeImageData));
  }

  public readText(
    conversationId: string,
    attachmentId: string,
    offset: number,
    limit: number
  ): {
    content: string;
    endOffset: number;
    name: string;
    startOffset: number;
    totalCharacters: number;
    truncated: boolean;
  } {
    const attachment = this.database.getConversationAttachment(
      conversationId,
      attachmentId
    );
    if (attachment.extractedTextPath === null) {
      throw new Error("This attachment does not contain readable text.");
    }
    const content = readFileSync(
      attachment.extractedTextPath,
      "utf8"
    );
    const startOffset = Math.min(offset, content.length);
    const endOffset = Math.min(startOffset + limit, content.length);
    return {
      content: content.slice(startOffset, endOffset),
      endOffset,
      name: attachment.name,
      startOffset,
      totalCharacters: content.length,
      truncated: endOffset < content.length
    };
  }

  private async importFile(
    conversationId: string,
    sourcePath: string
  ): Promise<ConversationAttachment> {
    const absoluteSourcePath = path.resolve(sourcePath);
    const fileStat = await stat(absoluteSourcePath);
    if (!fileStat.isFile()) throw new Error("只能把文件作为对话附件添加。");
    if (fileStat.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("单个附件不能超过 25 MB。");
    }

    const id = randomUUID();
    const name = path.basename(absoluteSourcePath).slice(0, 255);
    const extension = path.extname(name).toLowerCase();
    const detectedType = await fileTypeFromFile(absoluteSourcePath);
    const mimeType = detectedType?.mime
      ?? EXTENSION_MIME_TYPES[extension]
      ?? (TEXT_EXTENSIONS.has(extension) ? "text/plain" : "application/octet-stream");
    const directory = path.join(this.rootPath, conversationId);
    await mkdir(directory, { recursive: true });
    const storedPath = path.join(directory, `${id}${extension}`);
    await copyFile(absoluteSourcePath, storedPath);

    return this.completeImportedFile({
      conversationId,
      extension,
      id,
      mimeType,
      name,
      sizeBytes: fileStat.size,
      source: this.resolveSource(conversationId, absoluteSourcePath),
      storedPath,
    });
  }

  private async completeImportedFile(input: {
    conversationId: string;
    extension: string;
    id: string;
    mimeType: string;
    name: string;
    sizeBytes: number;
    source: AttachmentSource;
    storedPath: string;
  }): Promise<ConversationAttachment> {
    const kind = MODEL_IMAGE_MIME_TYPES.has(input.mimeType) ? "image" : "file";
    const extractedTextPath = kind === "file"
      ? path.join(path.dirname(input.storedPath), `${input.id}.extracted.txt`)
      : null;
    try {
      const extractedText = extractedTextPath === null
        ? null
        : await this.extractFileText(input.storedPath, input.mimeType, input.extension);
      const actualExtractedTextPath = extractedText === null ? null : extractedTextPath;
      if (actualExtractedTextPath !== null && extractedText !== null) {
        await writeFile(actualExtractedTextPath, extractedText, "utf8");
      }
      const truncated = extractedText !== null && extractedText.length > INLINE_TEXT_CHARACTERS;
      const contextTokens = kind === "image"
        ? this.estimateImageTokens(input.sizeBytes, { id: input.id, name: input.name, ...input.source })
        : estimateContextTokens(
            this.renderTextAttachment(
              { id: input.id, mimeType: input.mimeType, name: input.name, ...input.source },
              extractedText,
              truncated
            )
          );
      return this.database.createConversationAttachment({
        contextTokens,
        conversationId: input.conversationId,
        createdAt: new Date().toISOString(),
        extractedTextPath: actualExtractedTextPath,
        id: input.id,
        kind,
        messageId: null,
        pendingMessageId: null,
        mimeType: input.mimeType,
        name: input.name,
        projectPath: input.source.projectPath,
        sizeBytes: input.sizeBytes,
        source: input.source.source,
        storedPath: input.storedPath,
        truncated
      });
    } catch (error) {
      await this.removeFile(input.storedPath);
      if (extractedTextPath !== null) await this.removeFile(extractedTextPath);
      throw error;
    }
  }

  private assertCanAddDrafts(conversationId: string, count: number): void {
    const drafts = this.database.listDraftConversationAttachments(conversationId);
    if (drafts.length + count > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(`每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`);
    }
  }

  private async extractFileText(
    storedPath: string,
    mimeType: string,
    extension: string
  ): Promise<string | null> {
    if (mimeType === "application/pdf" || extension === ".pdf") {
      const buffer = await readFile(storedPath);
      const result = await extractText(new Uint8Array(buffer), { mergePages: true });
      return result.text;
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || extension === ".docx"
    ) {
      return (await mammoth.extractRawText({ path: storedPath })).value;
    }
    if (!mimeType.startsWith("text/") && !TEXT_MIME_TYPES.has(mimeType)
      && !TEXT_EXTENSIONS.has(extension)) {
      return null;
    }
    const buffer = await readFile(storedPath);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8").replace(/^\uFEFF/u, "");
  }

  private resolveSource(conversationId: string, sourcePath: string): AttachmentSource {
    const conversation = this.database.getConversation(conversationId);
    const workspaceId = conversation.projectId ?? (
      conversation.workspaceRootPath === null ? null : conversation.id
    );
    if (workspaceId === null) return { projectPath: null, source: "upload" };

    const workspaceRoot = path.resolve(this.projects.getProject(workspaceId).rootPath);
    const relativePath = path.relative(workspaceRoot, sourcePath);
    if (
      relativePath.length === 0
      || relativePath.startsWith(`..${path.sep}`)
      || relativePath === ".."
      || path.isAbsolute(relativePath)
    ) {
      return { projectPath: null, source: "upload" };
    }
    return {
      projectPath: relativePath.split(path.sep).join("/"),
      source: "project"
    };
  }

  private toModelAttachment(
    attachment: StoredConversationAttachment,
    includeImageData: boolean
  ): ModelMessageAttachment {
    if (attachment.kind === "image") {
      return {
        contextTokens: attachment.contextTokens,
        data: includeImageData
          ? readFileSync(attachment.storedPath).toString("base64")
          : null,
        id: attachment.id,
        kind: "image",
        mimeType: attachment.mimeType,
        name: attachment.name,
        projectPath: attachment.projectPath,
        readState: "full",
        source: attachment.source,
        truncated: false
      };
    }
    const extractedText = attachment.extractedTextPath === null
      ? null
      : readFileSync(attachment.extractedTextPath, "utf8");
    return {
      content: this.renderTextAttachment(attachment, extractedText, attachment.truncated),
      contextTokens: attachment.contextTokens,
      id: attachment.id,
      kind: "text",
      mimeType: attachment.mimeType,
      name: attachment.name,
      projectPath: attachment.projectPath,
      readState: extractedText === null
        ? "metadata_only"
        : attachment.truncated
          ? "preview"
          : "full",
      source: attachment.source,
      truncated: attachment.truncated
    };
  }

  private renderTextAttachment(
    attachment: Pick<StoredConversationAttachment, "id" | "mimeType" | "name" | "projectPath" | "source">,
    extractedText: string | null,
    truncated: boolean
  ): string {
    const location = attachment.projectPath === null
      ? "用户上传文件"
      : `项目文件 ${attachment.projectPath}`;
    const header = [
      `[附件 ${attachment.name}]`,
      `attachment_id: ${attachment.id}`,
      `source: ${location}`,
      `mime_type: ${attachment.mimeType}`
    ].join("\n");
    if (extractedText === null) {
      return `${header}\n该文件类型暂不支持提取文本；可依据名称和类型判断是否需要用户提供可读格式。`;
    }
    if (!truncated) return `${header}\n\n${extractedText}`;
    const head = extractedText.slice(0, INLINE_TEXT_HEAD_CHARACTERS);
    const tail = extractedText.slice(-INLINE_TEXT_TAIL_CHARACTERS);
    return [
      header,
      "文件内容较长，当前仅注入头尾预览。需要中间内容时调用 read_attachment。",
      head,
      `[中间省略 ${extractedText.length - head.length - tail.length} 个字符]`,
      tail
    ].join("\n\n");
  }

  private estimateImageTokens(
    sizeBytes: number,
    attachment: Pick<ModelMessageAttachment, "id" | "name" | "projectPath" | "source">
  ): number {
    const fileEstimate = Math.ceil(sizeBytes / 2_048);
    return Math.min(
      IMAGE_CONTEXT_TOKENS_MAX,
      Math.max(IMAGE_CONTEXT_TOKENS_MIN, fileEstimate)
    ) + estimateContextTokens(modelImageAttachmentCaption(attachment));
  }

  private async removeFile(filePath: string): Promise<void> {
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
