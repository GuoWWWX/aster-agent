import {
  Bot,
  ChevronDown,
  GitBranch,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type {
  ConversationTimelineItem,
  GitReviewSnapshot,
  ProjectSummary,
} from "@agent/protocol";

import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { IconButton } from "../../components/ui/icon-button.js";
import type { AgentClient } from "../../runtime/index.js";
import { SubagentAvatar } from "../team/agent-avatar.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { getGitReviewCache } from "../workspace/git-review-cache.js";

type ConversationHeaderControlsProps = {
  agentClient: AgentClient;
  project: ProjectSummary | null;
  subagents: readonly ProjectSession[];
  onDeleteSubagent?: (subagent: ProjectSession) => Promise<void>;
  onOpenGitReview?: (path?: string) => void;
  onOpenSubagent?: (subagent: ProjectSession) => void;
};

const SUBAGENT_PREVIEW_CONCURRENCY = 2;

export function ConversationHeaderControls({
  agentClient,
  project,
  subagents,
  onDeleteSubagent,
  onOpenGitReview,
  onOpenSubagent,
}: ConversationHeaderControlsProps): ReactElement | null {
  const [subagentOpen, setSubagentOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [deletingSubagentId, setDeletingSubagentId] = useState<string | null>(null);
  const [subagentActionError, setSubagentActionError] = useState<string | null>(null);
  const [subagentPreviews, setSubagentPreviews] = useState<Record<string, string>>({});
  const subagentPreviewCacheRef = useRef(new Map<string, string>());
  const subagentPreviewRevisionRef = useRef(new Map<string, string>());
  const [gitAvailable, setGitAvailable] = useState(false);
  const gitReviewCache = getGitReviewCache(agentClient);
  const [gitSnapshotState, setGitSnapshotState] = useState<{
    projectId: string;
    snapshot: GitReviewSnapshot;
  } | null>(null);
  const visibleSubagents = useMemo(
    () => subagents.filter((subagent) => !subagent.isArchived),
    [subagents],
  );
  const activeSubagents = useMemo(
    () => visibleSubagents.filter(isActiveSubagent),
    [visibleSubagents],
  );
  const completedSubagents = useMemo(
    () => visibleSubagents.filter((subagent) => (
      !isActiveSubagent(subagent) && subagent.subagentTaskStatus !== "ended"
    )),
    [visibleSubagents],
  );
  const endedSubagents = useMemo(
    () => visibleSubagents.filter((subagent) => subagent.subagentTaskStatus === "ended"),
    [visibleSubagents],
  );

  const deleteSubagent = async (subagent: ProjectSession): Promise<void> => {
    if (onDeleteSubagent === undefined || !canDeleteSubagent(subagent)) return;
    setDeletingSubagentId(subagent.id);
    setSubagentActionError(null);
    try {
      await onDeleteSubagent(subagent);
    } catch (error) {
      setSubagentActionError(error instanceof Error ? error.message : "无法删除子代理。");
    } finally {
      setDeletingSubagentId(null);
    }
  };

  useEffect(() => {
    let disposed = false;
    void agentClient.getCapabilities().then((capabilities) => {
      if (!disposed) setGitAvailable(capabilities.git);
    }).catch(() => {
      if (!disposed) setGitAvailable(false);
    });
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  useEffect(() => {
    if (project === null || !gitAvailable) return;
    let disposed = false;
    const applySnapshot = (snapshot: GitReviewSnapshot): void => {
      if (!disposed) setGitSnapshotState({ projectId: project.id, snapshot });
    };
    const unsubscribe = gitReviewCache.subscribe(project.id, applySnapshot);
    void gitReviewCache.warmProject(project.id).then(applySnapshot).catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [gitAvailable, gitReviewCache, project]);

  useEffect(() => {
    const visibleIds = new Set(visibleSubagents.map((subagent) => subagent.id));
    let cacheChanged = false;
    for (const cachedId of subagentPreviewCacheRef.current.keys()) {
      if (visibleIds.has(cachedId)) continue;
      subagentPreviewCacheRef.current.delete(cachedId);
      subagentPreviewRevisionRef.current.delete(cachedId);
      cacheChanged = true;
    }
    for (const subagent of visibleSubagents) {
      const revision = subagent.updatedAt
        ?? `${subagent.activeRunId ?? "idle"}:${subagent.lastRunStatus ?? "none"}:${subagent.subagentTaskStatus ?? "none"}`;
      if (subagentPreviewRevisionRef.current.get(subagent.id) === revision) continue;
      subagentPreviewRevisionRef.current.set(subagent.id, revision);
      cacheChanged = subagentPreviewCacheRef.current.delete(subagent.id) || cacheChanged;
    }
    if (!cacheChanged) return;
    setSubagentPreviews((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => subagentPreviewCacheRef.current.has(id)),
    ));
  }, [visibleSubagents]);

  useEffect(() => {
    if (!subagentOpen || visibleSubagents.length === 0) return;
    let disposed = false;
    const pendingSubagents = visibleSubagents.filter(
      (subagent) => !subagentPreviewCacheRef.current.has(subagent.id),
    );
    let nextIndex = 0;
    const loadNext = async (): Promise<void> => {
      while (!disposed) {
        const subagent = pendingSubagents[nextIndex];
        nextIndex += 1;
        if (subagent === undefined) return;
        let preview: string;
        try {
          const timeline = await agentClient.listConversationTimeline({
            conversationId: subagent.id,
          });
          preview = latestSubagentOutput(timeline, isActiveSubagent(subagent));
        } catch {
          preview = isActiveSubagent(subagent) ? "正在处理…" : "暂无模型输出";
        }
        if (disposed) return;
        subagentPreviewCacheRef.current.set(subagent.id, preview);
        setSubagentPreviews((current) => current[subagent.id] === preview
          ? current
          : { ...current, [subagent.id]: preview });
      }
    };
    const workerCount = Math.min(SUBAGENT_PREVIEW_CONCURRENCY, pendingSubagents.length);
    for (let index = 0; index < workerCount; index += 1) void loadNext();
    return () => {
      disposed = true;
    };
  }, [agentClient, subagentOpen, visibleSubagents]);

  const gitSnapshot = project !== null && gitSnapshotState?.projectId === project.id
    ? gitSnapshotState.snapshot
    : null;

  return (
    <div className="conversation-header-controls">
      <div
        aria-label={`${activeSubagents.length} 个活跃子代理`}
        className="conversation-header-subagents"
      >
        <span className="conversation-header-subagents__avatars">
          {activeSubagents.length === 0 ? (
            <span
              aria-hidden="true"
              className="conversation-header-subagents__placeholder"
              title="暂无活跃子代理"
            >
              <Bot size={12} />
            </span>
          ) : (
            activeSubagents.slice(0, 4).map((subagent) => (
              <button
                aria-label={`打开活跃子代理 ${subagent.title}`}
                className="conversation-header-subagents__avatar"
                key={subagent.id}
                title={subagent.title}
                type="button"
                onClick={() => onOpenSubagent?.(subagent)}
              >
                <SubagentStatusAvatar subagent={subagent} />
              </button>
            ))
          )}
        </span>
        <span className="conversation-header-control__count">{activeSubagents.length}</span>
      </div>

      {visibleSubagents.length === 0 ? null : (
          <Popover open={subagentOpen} onOpenChange={setSubagentOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="查看全部子代理"
                className="conversation-header-control conversation-header-control--subagent-menu"
                data-open={subagentOpen}
                title={`${visibleSubagents.length} 个子代理`}
                type="button"
              >
                <ChevronDown aria-hidden="true" className="conversation-header-control__chevron" size={13} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="conversation-header-popover conversation-header-popover--subagents"
              side="bottom"
              sideOffset={5}
            >
            <SubagentGroup
              deletingSubagentId={deletingSubagentId}
              label="正在运行"
              previews={subagentPreviews}
              subagents={activeSubagents}
              onDelete={(subagent) => void deleteSubagent(subagent)}
              onOpen={(subagent) => {
                setSubagentOpen(false);
                onOpenSubagent?.(subagent);
              }}
            />
            <SubagentGroup
              deletingSubagentId={deletingSubagentId}
              label="完成工作"
              previews={subagentPreviews}
              subagents={completedSubagents}
              onDelete={(subagent) => void deleteSubagent(subagent)}
              onOpen={(subagent) => {
                setSubagentOpen(false);
                onOpenSubagent?.(subagent);
              }}
            />
            <SubagentGroup
              deletingSubagentId={deletingSubagentId}
              label="已结束"
              previews={subagentPreviews}
              subagents={endedSubagents}
              onDelete={(subagent) => void deleteSubagent(subagent)}
              onOpen={(subagent) => {
                setSubagentOpen(false);
                onOpenSubagent?.(subagent);
              }}
            />
              {subagentActionError === null ? null : (
                <p className="conversation-header-popover__error" role="alert">{subagentActionError}</p>
              )}
            </PopoverContent>
          </Popover>
      )}

      {project === null || !gitAvailable ? null : (
        <Popover open={gitOpen} onOpenChange={setGitOpen}>
          <PopoverTrigger asChild>
            <button
              aria-label="查看 Git 变更"
              className="conversation-header-control conversation-header-control--git"
              data-open={gitOpen}
              title={gitSnapshot?.isRepository === false ? "当前项目不是 Git 仓库" : "查看 Git 变更"}
              type="button"
            >
              <GitBranch aria-hidden="true" size={14} />
              <span className="conversation-header-control__branch">
                {gitSnapshot?.branch ?? "Git"}
              </span>
              {gitSnapshot?.isRepository === true ? (
                <GitTotals snapshot={gitSnapshot} />
              ) : null}
              <ChevronDown aria-hidden="true" className="conversation-header-control__chevron" size={13} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="conversation-header-popover conversation-header-popover--git"
            side="bottom"
            sideOffset={5}
          >
            <div className="conversation-header-popover__heading">
              <span><GitBranch aria-hidden="true" size={14} />当前分支</span>
              <strong>{gitSnapshot?.branch ?? "未识别"}</strong>
            </div>
            {gitSnapshot === null ? (
              <p className="conversation-header-popover__empty">正在读取 Git 状态…</p>
            ) : !gitSnapshot.isRepository ? (
              <p className="conversation-header-popover__empty">当前项目不是 Git 仓库</p>
            ) : gitSnapshot.changes.length === 0 ? (
              <p className="conversation-header-popover__empty">工作区没有文件变更</p>
            ) : (
              <div className="conversation-header-popover__files">
                {gitSnapshot.changes.map((change) => (
                  <button
                    aria-label={`查看 ${change.path} 的文件差异`}
                    className="conversation-header-popover__file"
                    disabled={onOpenGitReview === undefined}
                    key={change.path}
                    title={change.path}
                    type="button"
                    onClick={() => {
                      setGitOpen(false);
                      onOpenGitReview?.(change.path);
                    }}
                  >
                    <span title={change.path}>{change.path}</span>
                    {change.additions === null || change.deletions === null ? (
                      <small>二进制</small>
                    ) : (
                      <small>
                        <span data-kind="addition">+{change.additions}</span>
                        <span data-kind="deletion">−{change.deletions}</span>
                      </small>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              aria-label="打开完整 Git 审阅"
              className="conversation-header-popover__open"
              disabled={onOpenGitReview === undefined || gitSnapshot?.isRepository !== true}
              type="button"
              onClick={() => {
                setGitOpen(false);
                onOpenGitReview?.();
              }}
            >
              打开完整 Git 审阅
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function SubagentGroup({
  deletingSubagentId,
  label,
  previews,
  subagents,
  onDelete,
  onOpen,
}: {
  deletingSubagentId: string | null;
  label: string;
  previews: Readonly<Record<string, string>>;
  subagents: readonly ProjectSession[];
  onDelete: (subagent: ProjectSession) => void;
  onOpen: (subagent: ProjectSession) => void;
}): ReactElement | null {
  if (subagents.length === 0) return null;
  return (
    <section className="conversation-header-popover__group">
      <h2>{label}<span>{subagents.length}</span></h2>
      {subagents.map((subagent) => (
        <div
          className="conversation-header-popover__subagent"
          data-subagent-id={subagent.id}
          key={subagent.id}
        >
          <button
            aria-label={`打开子代理对话 ${subagent.title}`}
            className="conversation-header-popover__subagent-open"
            type="button"
            onClick={() => onOpen(subagent)}
          >
            <SubagentStatusAvatar subagent={subagent} />
            <span className="conversation-header-popover__subagent-copy">
              <strong>{subagent.title}</strong>
              <small>{previews[subagent.id] ?? (isActiveSubagent(subagent) ? "正在处理…" : "正在读取输出…")}</small>
            </span>
          </button>
          {canDeleteSubagent(subagent) ? (
            <span className="conversation-header-popover__subagent-actions">
              <IconButton
                disabled={deletingSubagentId === subagent.id}
                label={`删除子代理 ${subagent.title}`}
                size="compact"
                variant="quiet"
                onClick={() => onDelete(subagent)}
              >
                <X aria-hidden="true" size={14} />
              </IconButton>
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}

type SubagentVisualStatus = "ended" | "completed" | "failed" | "working";

function SubagentStatusAvatar({ subagent }: { subagent: ProjectSession }): ReactElement {
  const status = subagentVisualStatus(subagent);
  const label = status === "working"
    ? "工作中"
    : status === "failed"
      ? "执行出错"
      : status === "completed"
        ? "已完成"
        : "已结束";
  return (
    <span
      aria-label={label}
      className="conversation-header-popover__subagent-avatar"
      data-subagent-status={status}
      role="img"
      title={label}
    >
      <SubagentAvatar icon={subagent.avatarIcon} seed={subagent.id} size="compact" />
      <span aria-hidden="true" className="conversation-header-popover__subagent-status" />
    </span>
  );
}

function subagentVisualStatus(subagent: ProjectSession): SubagentVisualStatus {
  if (subagent.subagentTaskStatus === "ended") return "ended";
  if (isActiveSubagent(subagent)) return "working";
  if (subagent.lastRunStatus !== null) {
    return subagent.lastRunStatus === "failed" ? "failed" : "completed";
  }
  return subagent.subagentTaskStatus === "failed" ? "failed" : "completed";
}

function canDeleteSubagent(subagent: ProjectSession): boolean {
  return !isActiveSubagent(subagent);
}

function GitTotals({ snapshot }: { snapshot: GitReviewSnapshot }): ReactElement | null {
  const additions = snapshot.changes.reduce((total, change) => total + (change.additions ?? 0), 0);
  const deletions = snapshot.changes.reduce((total, change) => total + (change.deletions ?? 0), 0);
  if (additions === 0 && deletions === 0 && snapshot.changes.length === 0) return null;
  return (
    <span className="conversation-header-control__git-totals">
      <span data-kind="addition">+{additions}</span>
      <span data-kind="deletion">−{deletions}</span>
    </span>
  );
}

function isActiveSubagent(subagent: ProjectSession): boolean {
  return subagent.activeRunId !== null
    || subagent.subagentTaskStatus === "queued"
    || subagent.subagentTaskStatus === "running";
}

function latestSubagentOutput(
  timeline: readonly ConversationTimelineItem[],
  active: boolean,
): string {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind !== "message" || item.role !== "assistant") continue;
    const normalized = item.content
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/giu, " ")
      .replace(/[`*_>#()[\]~-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (normalized.length > 0) return normalized;
  }
  return active ? "正在处理…" : "暂无模型输出";
}
