import { LoadingState, Spinner } from "../../../components/ui/loading.js";
import { Archive, ArchiveRestore, MessageSquareText, Trash2 } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ARCHIVED_CONVERSATION_RETENTION_DAYS,
  type ConversationSummary,
  type ProjectSummary,
} from "@agent/protocol";
import { getUserErrorMessage, type AgentClient } from "../../../runtime/index.js";
import {
  getArchivedConversationDaysRemaining,
  getArchivedConversations,
} from "../archived-conversation-model.js";
import { errorMessage } from "../configuration-state.js";

export function ArchivedConversationsSettings({
  agentClient,
}: {
  agentClient: AgentClient;
}): ReactElement {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [busyOperation, setBusyOperation] = useState<"delete" | "restore" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      agentClient.listConversations(),
      agentClient.listProjects(),
    ])
      .then(([nextConversations, nextProjects]) => {
        if (disposed) return;
        setConversations(nextConversations);
        setProjects(nextProjects);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setOperationError(getUserErrorMessage(reason, "无法读取已归档对话"));
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  const archivedConversations = useMemo(
    () => getArchivedConversations(conversations),
    [conversations],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const restoreConversation = async (conversation: ConversationSummary): Promise<void> => {
    setBusyConversationId(conversation.id);
    setBusyOperation("restore");
    setOperationError(null);
    try {
      const restored = await agentClient.setConversationArchived({
        archived: false,
        conversationId: conversation.id,
      });
      setConversations((current) => current.map((candidate) =>
        candidate.id === restored.id ? restored : candidate
      ));
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setBusyConversationId(null);
      setBusyOperation(null);
    }
  };

  const permanentlyDeleteConversation = async (
    conversation: ConversationSummary,
  ): Promise<void> => {
    setBusyConversationId(conversation.id);
    setBusyOperation("delete");
    setOperationError(null);
    try {
      await agentClient.deleteConversation({ conversationId: conversation.id });
      setConversations((current) => current.filter(
        (candidate) => candidate.id !== conversation.id,
      ));
      setPendingDelete(null);
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setBusyConversationId(null);
      setBusyOperation(null);
    }
  };

  return (
    <SettingsSectionHeader
      eyebrow="对话生命周期"
      title="已归档对话"
      action={<span className="settings-state-badge">保留 {ARCHIVED_CONVERSATION_RETENTION_DAYS} 天</span>}
    >
      <p className="settings-archived-description">
        归档对话不会显示在项目栏中，到期后由应用自动永久删除。
      </p>
      {operationError === null ? null : (
        <p className="settings-operation-error" role="alert">{operationError}</p>
      )}
      {isLoading ? (
        <LoadingState label="正在读取归档记录" className="h-full flex-1" />
      ) : archivedConversations.length === 0 ? (
        <div className="settings-archived-empty">
          <Archive aria-hidden="true" size={22} />
          <strong>暂无已归档对话</strong>
          <span>从项目栏归档的对话会显示在这里。</span>
        </div>
      ) : (
        <div className="settings-archived-list" role="list">
          {archivedConversations.map((conversation) => {
            const isRestoring = busyConversationId === conversation.id
              && busyOperation === "restore";
            const isDeleting = busyConversationId === conversation.id
              && busyOperation === "delete";
            const remainingDays = getArchivedConversationDaysRemaining(
              conversation.archivedAt,
            );
            const projectName = conversation.projectId === null
              ? "临时对话"
              : projectNames.get(conversation.projectId) ?? "项目已移除";

            return (
              <article key={conversation.id} className="settings-archived-row" role="listitem">
                <span className="settings-configuration-row__icon">
                  <MessageSquareText aria-hidden="true" size={16} />
                </span>
                <div className="settings-archived-row__identity">
                  <strong>{conversation.title}</strong>
                  <span>{projectName}</span>
                </div>
                <dl className="settings-archived-row__meta">
                  <div>
                    <dt>归档时间</dt>
                    <dd>{formatArchivedConversationDate(conversation.archivedAt)}</dd>
                  </div>
                  <div>
                    <dt>自动清理</dt>
                    <dd>{remainingDays === 0 ? "等待清理" : `还剩 ${remainingDays} 天`}</dd>
                  </div>
                </dl>
                <div className="settings-archived-row__actions">
                  <button
                    className="settings-secondary-button"
                    disabled={busyConversationId !== null}
                    type="button"
                    onClick={() => void restoreConversation(conversation)}
                  >
                    {isRestoring ? (
                      <Spinner aria-hidden="true" size={14} />
                    ) : (
                      <ArchiveRestore aria-hidden="true" size={14} />
                    )}
                    {isRestoring ? "恢复中" : "恢复"}
                  </button>
                  <button
                    className="settings-danger-button"
                    disabled={busyConversationId !== null}
                    type="button"
                    onClick={() => setPendingDelete(conversation)}
                  >
                    {isDeleting ? (
                      <Spinner aria-hidden="true" size={14} />
                    ) : (
                      <Trash2 aria-hidden="true" size={14} />
                    )}
                    永久删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingDelete === null ? null : (
        <div
          className="settings-archived-dialog-backdrop"
          onClick={(event) => {
            if (event.currentTarget === event.target && busyConversationId === null) {
              setPendingDelete(null);
            }
          }}
        >
          <section
            aria-labelledby="settings-archived-delete-title"
            aria-modal="true"
            className="settings-archived-dialog"
            role="dialog"
          >
            <header>
              <Trash2 aria-hidden="true" size={17} />
              <h3 id="settings-archived-delete-title">永久删除对话</h3>
            </header>
            <p>“{pendingDelete.title}”的消息、任务和工具记录都会被删除，且无法恢复。</p>
            <footer>
              <button
                autoFocus
                className="settings-secondary-button"
                disabled={busyConversationId !== null}
                type="button"
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                className="settings-danger-button"
                disabled={busyConversationId !== null}
                type="button"
                onClick={() => void permanentlyDeleteConversation(pendingDelete)}
              >
                {busyConversationId === pendingDelete.id && busyOperation === "delete" ? (
                  <Spinner aria-hidden="true" size={14} />
                ) : (
                  <Trash2 aria-hidden="true" size={14} />
                )}
                {busyConversationId === pendingDelete.id && busyOperation === "delete"
                  ? "删除中"
                  : "永久删除"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </SettingsSectionHeader>
  );
}

function formatArchivedConversationDate(archivedAt: string | null): string {
  if (archivedAt === null) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(archivedAt));
}
