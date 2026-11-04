import { conversationAttachmentListSchema, type ConversationToolItem } from "@agent/protocol";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import type { AgentClient } from "../../runtime/index.js";
import { AttachmentChip, AttachmentStrip } from "./conversation-attachments.js";
import { ImagePreviewStrip } from "./image-preview-strip.js";
import { ProjectImageResult } from "./project-image-result.js";
import { StructuredToolResult, ToolResultNotice } from "./tool-result-content.js";
import { isRecord, parseToolPayload, parseToolValue } from "./tool-result-payload.js";
import {
  parseProjectOperationResult,
  projectOperationStatusLabel,
  parseProjectInfoResult,
  parseDirectoryListingResult,
  parseFileReadResult,
  parseAttachmentReadResult,
  parseAttachmentViewResult,
  parseSearchTextResult,
  parseWebSearchResult,
  parseFindFilesResult,
} from "./workspace-tool-result-model.js";

export function ProjectOperationResult({
  mode,
  payload,
  status,
}: {
  mode: "list" | "wait";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseProjectOperationResult(payload, mode);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  const summary = mode === "wait"
    ? result.waitStatus === "timeout"
      ? "项目操作等待超时"
      : "项目操作等待结束"
    : `进行中的项目操作 · ${result.operations.length} 项`;
  return (
    <StructuredToolResult summary={summary}>
      {result.operations.length === 0 ? (
        <p className="tool-directory-listing__empty">当前没有其他对话占用项目写操作</p>
      ) : (
        <ul className="tool-search-results">
          {result.operations.map((operation) => (
            <li key={operation.operationId}>
              <span className="tool-search-results__path">
                {operation.scope.kind === "file" ? operation.scope.path : operation.scope.command}
              </span>
              <span className="tool-search-results__excerpt">
                {operation.conversationTitle} · {projectOperationStatusLabel(operation.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

export function ProjectInfoResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseProjectInfoResult(payload);
  if (result === null) {
    return <ToolResultNotice result={payload} status={status} />;
  }

  return (
    <StructuredToolResult summary="项目信息">
      <dl className="tool-read-facts">
        <div>
          <dt>项目名称</dt>
          <dd>{result.name}</dd>
        </div>
        <div>
          <dt>项目根目录</dt>
          <dd>{result.rootPath}</dd>
        </div>
      </dl>
    </StructuredToolResult>
  );
}

export function DirectoryListingResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseDirectoryListingResult(payload);
  if (result === null) {
    return <ToolResultNotice result={payload} status={status} />;
  }

  const directoryLabel = result.directoryPath.length === 0
    ? "工作区根目录"
    : result.directoryPath;

  return (
    <StructuredToolResult summary={`${directoryLabel} · ${result.entries.length} 项`}>
      {result.entries.length === 0 ? (
        <p className="tool-directory-listing__empty">目录为空</p>
      ) : (
        <ul className="tool-directory-listing">
          {result.entries.map((entry) => (
            <li key={entry.path} data-kind={entry.kind}>
              {entry.kind === "directory" ? (
                <FolderOpen aria-hidden="true" size={14} />
              ) : (
                <FileTypeIcon path={entry.path} size={14} />
              )}
              <span className="tool-directory-listing__name" title={entry.path}>{entry.name}</span>
              <span className="tool-directory-listing__kind">
                {entry.kind === "directory" ? "文件夹" : entry.kind === "symlink" ? "链接" : "文件"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">目录项过多，仅显示前 1000 项。</p> : null}
    </StructuredToolResult>
  );
}

export function FileReadResult({
  argumentsPayload,
  payload,
  status,
}: {
  argumentsPayload: string;
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseFileReadResult(payload);
  const args = parseToolPayload(argumentsPayload);
  const path = result?.path ?? (typeof args?.path === "string" ? args.path : "");
  const startLine = result?.startLine ?? (typeof args?.startLine === "number" ? args.startLine : 1);
  const endLine = result?.endLine ?? (typeof args?.endLine === "number" ? args.endLine
    : startLine + (typeof args?.lineCount === "number" ? args.lineCount : 400) - 1);
  return (
    <section className="tool-timeline-item__payload">
      <p className="tool-timeline-item__payload-label break-all">
        {path} · 第 {startLine}-{endLine} 行
        {result?.totalLines == null ? "" : `，共 ${result.totalLines} 行`}
      </p>
      {result === null ? <ToolResultNotice result={payload} status={status} /> : null}
    </section>
  );
}

export function AttachmentReadResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAttachmentReadResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult
      summary={`${result.name} · 字符 ${result.startOffset}-${result.endOffset} / ${result.totalCharacters}`}
    >
      {result.truncated ? (
        <p className="tool-directory-listing__notice">附件后面仍有内容，可继续按偏移量读取。</p>
      ) : null}
    </StructuredToolResult>
  );
}

export function AttachmentViewResult({
  agentClient,
  payload,
  status,
}: {
  agentClient: AgentClient;
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const items = payload === null ? null : parseToolValue(payload)?.items;
  if (Array.isArray(items)) return <ImagePreviewStrip label="查看的附件">
    {items.map((item: unknown, index: number) => {
      if (!isRecord(item)) return null;
      if (isRecord(item.image)) return <div className="shrink-0" key={index}><ProjectImageResult agentClient={agentClient} payload={JSON.stringify({ ok: true, value: { image: item.image } })} /></div>;
      const attachment = conversationAttachmentListSchema.safeParse([item.attachment]);
      const value = attachment.success ? attachment.data[0] : undefined;
      return value === undefined ? null : <AttachmentChip agentClient={agentClient} attachment={value} key={index} />;
    })}
  </ImagePreviewStrip>;
  const attachments = payload === null ? null : parseAttachmentViewResult(payload);
  if (attachments === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`查看 ${attachments.length} 个附件`}>
      <AttachmentStrip variant="message">
        {attachments.map((attachment) => (
          <AttachmentChip
            agentClient={agentClient}
            attachment={attachment}
            key={attachment.id}
          />
        ))}
      </AttachmentStrip>
    </StructuredToolResult>
  );
}

export function SearchTextResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseSearchTextResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult
      summary={`${result.mode === "regex" ? "正则搜索" : "文本搜索"} · ${result.matches.length} 项${
        result.scannedFiles === null ? "" : ` · 扫描 ${result.scannedFiles} 个文件`
      }`}
    >
      {result.matches.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到匹配内容</p>
      ) : (
        <ul className="tool-search-results">
          {result.matches.map((match, index) => (
            <li key={`${match.path}:${match.line}:${index}`}>
              <span className="tool-search-results__path">{match.path}:{match.line}</span>
              <span className="tool-search-results__excerpt">{match.text}</span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">搜索结果已达到数量限制。</p> : null}
    </StructuredToolResult>
  );
}

export function WebSearchResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseWebSearchResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`网页搜索 · ${result.results.length} 项`}>
      {result.results.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到网页结果</p>
      ) : (
        <ul className="tool-search-results">
          {result.results.map((item) => (
            <li key={item.url}>
              <a href={item.url} rel="noreferrer" target="_blank">{item.title || item.url}</a>
              <span className="tool-search-results__path">{item.hostname}</span>
              {item.description.length === 0 ? null : (
                <span className="tool-search-results__excerpt">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

export function FindFilesResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseFindFilesResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`${result.pattern} · ${result.matches.length} 个文件`}>
      {result.matches.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到匹配文件</p>
      ) : (
        <ul className="tool-directory-listing">
          {result.matches.map((match) => (
            <li key={match} data-kind="file">
              <FileTypeIcon path={match} size={14} />
              <span className="tool-directory-listing__name" title={match}>{match}</span>
              <span className="tool-directory-listing__kind">文件</span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">文件结果已达到扫描限制。</p> : null}
    </StructuredToolResult>
  );
}
