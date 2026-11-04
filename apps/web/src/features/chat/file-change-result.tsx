import { Copy } from "lucide-react";
import { useState, type ReactElement } from "react";
import { createDiffPresentation, DiffView, type DiffPresentation } from "../../components/diff/diff-view.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { ToolErrorNotice, ToolResultNotice, copyTextWithFeedback } from "./tool-result-content.js";
import { parseToolError } from "./tool-result-payload.js";
import { fileNameFromPath } from "./workspace-tool-result-model.js";

export function FileChangeResult({
  diff,
  onOpenProjectFile,
  result,
  toolName,
}: {
  diff: string | null;
  onOpenProjectFile: ((path: string) => void) | undefined;
  result: string | null;
  toolName: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const error = result === null ? null : parseToolError(result);

  if (diff !== null) {
    const presentation = createDiffPresentation(diff);
    const changeType = fileChangeType(toolName, presentation);

    return (
      <section
        className="tool-timeline-item__payload tool-structured-result tool-file-change"
        data-change-type={changeType}
      >
        <header className="tool-file-change__header">
          {onOpenProjectFile === undefined ? (
            <span
              className="tool-file-change__path inline-flex items-center gap-1"
              title={presentation.path}
            >
              <FileTypeIcon className="shrink-0" path={presentation.path} size={14} />
              <span className="min-w-0 truncate">
                {fileNameFromPath(presentation.path)}
              </span>
            </span>
          ) : (
            <button
              aria-label={`在侧边工作区打开文件 ${presentation.path}`}
              className="tool-file-change__path inline-flex items-center gap-1"
              title={`在侧边工作区打开 ${presentation.path}`}
              type="button"
              onClick={() => onOpenProjectFile(presentation.path)}
            >
              <FileTypeIcon className="shrink-0" path={presentation.path} size={14} />
              <span className="min-w-0 truncate">
                {fileNameFromPath(presentation.path)}
              </span>
            </button>
          )}
          <span className="tool-file-change__summary">
            <span data-kind="addition">+{presentation.additions}</span>
            <span data-kind="deletion">-{presentation.deletions}</span>
          </span>
          <IconButton
            className="tool-file-change__copy"
            label={copied ? "已复制变更内容" : "复制变更内容"}
            size="compact"
            variant="quiet"
            onClick={() => void copyDiff(diff, setCopied)}
          >
            <Copy aria-hidden="true" size={15} />
          </IconButton>
        </header>
        <div className="tool-structured-result__content">
          <DiffView presentation={presentation} />
        </div>
        {error === null ? null : <ToolErrorNotice message={error} />}
      </section>
    );
  }

  return <ToolResultNotice result={result} status="failed" />;
}

function fileChangeType(toolName: string, presentation: DiffPresentation): "created" | "deleted" | "updated" {
  if (toolName === "delete_file" || (presentation.additions === 0 && presentation.deletions > 0)) {
    return "deleted";
  }
  if (presentation.additions > 0 && presentation.deletions === 0) return "created";
  return "updated";
}

async function copyDiff(diff: string, setCopied: (copied: boolean) => void): Promise<void> {
  await copyTextWithFeedback(diff, setCopied);
}
