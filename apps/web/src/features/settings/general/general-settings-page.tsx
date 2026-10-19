import { Spinner } from "../../../components/ui/loading.js";
import { Database, FolderOpen, MessageSquareText, PanelRight } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useEffect, useState, type ReactElement } from "react";
import {
  APPLICATION_DISPLAY_NAME,
  APPLICATION_HOME_ENVIRONMENT_VARIABLE,
  LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE,
  type ApplicationStorageLocation,
} from "@agent/protocol";
import { getUserErrorMessage, type AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { useApplicationSettingsStore } from "../../../stores/application-settings-store.js";

export function GeneralSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const defaultMessageDeliveryMode = useApplicationSettingsStore(
    (state) => state.defaultMessageDeliveryMode,
  );
  const setDefaultMessageDeliveryMode = useApplicationSettingsStore(
    (state) => state.setDefaultMessageDeliveryMode,
  );
  const sendShortcut = useApplicationSettingsStore((state) => state.sendShortcut);
  const setSendShortcut = useApplicationSettingsStore((state) => state.setSendShortcut);
  const showContextUsage = useApplicationSettingsStore((state) => state.showContextUsage);
  const setShowContextUsage = useApplicationSettingsStore((state) => state.setShowContextUsage);
  const filePanelOpen = useWorkbenchUiStore((state) => state.isFilePanelOpen);
  const projectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.isProjectNavigatorOpen,
  );
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setProjectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.setProjectNavigatorOpen,
  );
  const [storageLocation, setStorageLocation] = useState<ApplicationStorageLocation | null>(null);
  const [storageLocationBusy, setStorageLocationBusy] = useState(false);
  const [storageLocationError, setStorageLocationError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void agentClient.getApplicationStorageLocation().then(
      (location) => {
        if (!disposed) setStorageLocation(location);
      },
      (error) => {
        if (!disposed) setStorageLocationError(
          getUserErrorMessage(error, "无法读取软件数据目录"),
        );
      },
    );
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  const chooseStorageLocation = async (): Promise<void> => {
    setStorageLocationBusy(true);
    setStorageLocationError(null);
    try {
      const location = await agentClient.chooseApplicationStorageLocation();
      if (location !== null) setStorageLocation(location);
    } catch (error) {
      setStorageLocationError(getUserErrorMessage(error, "无法选择软件数据目录"));
    } finally {
      setStorageLocationBusy(false);
    }
  };

  const resetStorageLocation = async (): Promise<void> => {
    setStorageLocationBusy(true);
    setStorageLocationError(null);
    try {
      setStorageLocation(await agentClient.resetApplicationStorageLocation());
    } catch (error) {
      setStorageLocationError(getUserErrorMessage(error, "无法恢复默认数据目录"));
    } finally {
      setStorageLocationBusy(false);
    }
  };

  return (
    <SettingsSectionHeader
      bodyClassName="settings-section__body--general"
      eyebrow="应用默认行为"
      title="常规设置"
    >
      <section className="settings-general-category" aria-labelledby="conversation-editor-heading">
        <h3 id="conversation-editor-heading">
          <MessageSquareText aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          对话与编辑器
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>显示上下文与缓存用量</h4>
              <p>显示当前对话的上下文估算，以及输入框下方的 Provider 缓存命中率</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示上下文与缓存用量"
                checked={showContextUsage}
                type="checkbox"
                onChange={(event) => setShowContextUsage(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>发送快捷键</h4>
              <p>{sendShortcut === "enter" ? "按 Enter 发送，Shift+Enter 换行" : "按 Ctrl+Enter 发送，Enter 换行"}</p>
            </div>
            <div className="settings-segmented" role="group" aria-label="发送快捷键">
              <button
                aria-pressed={sendShortcut === "enter"}
                type="button"
                onClick={() => setSendShortcut("enter")}
              >
                Enter 发送
              </button>
              <button
                aria-pressed={sendShortcut === "ctrl_enter"}
                type="button"
                onClick={() => setSendShortcut("ctrl_enter")}
              >
                Ctrl+Enter 发送
              </button>
            </div>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>运行中消息投递</h4>
              <p>
                {defaultMessageDeliveryMode === "queue"
                  ? "默认加入待发送队列"
                  : "默认介入当前任务"}
              </p>
            </div>
            <div className="settings-segmented" role="group" aria-label="运行中消息默认投递方式">
              <button
                aria-pressed={defaultMessageDeliveryMode === "queue"}
                type="button"
                onClick={() => setDefaultMessageDeliveryMode("queue")}
              >
                排队
              </button>
              <button
                aria-pressed={defaultMessageDeliveryMode === "steer"}
                type="button"
                onClick={() => setDefaultMessageDeliveryMode("steer")}
              >
                直接
              </button>
            </div>
          </article>

        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="workspace-heading">
        <h3 id="workspace-heading">
          <PanelRight aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          工作区
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div>
              <h4>对话列表</h4>
              <p>在对话页左侧显示项目、置顶和临时对话</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示对话列表"
                checked={projectNavigatorOpen}
                type="checkbox"
                onChange={(event) => setProjectNavigatorOpen(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>

          <article className="settings-general-row">
            <div>
              <h4>右侧工作区</h4>
              <p>显示文件、终端和侧边对话标签</p>
            </div>
            <label className="settings-switch">
              <input
                aria-label="显示右侧工作区"
                checked={filePanelOpen}
                type="checkbox"
                onChange={(event) => setFilePanelOpen(event.target.checked)}
              />
              <span aria-hidden="true" />
            </label>
          </article>
        </div>
      </section>

      <section className="settings-general-category" aria-labelledby="storage-location-heading">
        <h3 id="storage-location-heading">
          <Database aria-hidden="true" size={16} className="shrink-0 text-[var(--app-muted-foreground)]" />
          数据存储
        </h3>
        <div className="settings-general-card">
          <article className="settings-general-row">
            <div className="min-w-0 flex-1">
              <h4>{APPLICATION_DISPLAY_NAME} 数据目录</h4>
              <p>保存配置、对话、附件、本地数据库和无项目对话的工作文件。</p>
              <code
                className="mt-[5px] block truncate rounded-[var(--app-radius-small)] border border-[var(--app-border)] bg-[var(--app-panel)] px-2 py-1 font-mono text-[length:var(--app-font-size-control)] text-[var(--app-foreground)]"
                title={storageLocation?.activePath}
              >
                {storageLocation?.activePath ?? "正在读取…"}
              </code>
              {storageLocation?.restartRequired ? (
                <p className="break-all text-[var(--app-status-warning-fg)]">
                  重启后使用：{storageLocation.configuredPath}。原目录内容不会被删除或自动搬迁。
                </p>
              ) : null}
              {storageLocation?.source === "environment" ? (
                <p>
                  当前由 {APPLICATION_HOME_ENVIRONMENT_VARIABLE} 或兼容的
                  {` ${LEGACY_APPLICATION_HOME_ENVIRONMENT_VARIABLE}`} 环境变量控制。
                </p>
              ) : null}
              {storageLocation?.configurationError ? (
                <p className="text-[var(--app-destructive)]">
                  目录设置无法读取，当前已回退到默认目录；重新选择或恢复默认可修复。
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-[5px]">
              <button
                className="settings-secondary-button"
                disabled={storageLocationBusy || storageLocation === null || !storageLocation.canChange}
                type="button"
                onClick={() => void chooseStorageLocation()}
              >
                {storageLocationBusy ? (
                  <Spinner aria-hidden="true" size={14} />
                ) : (
                  <FolderOpen aria-hidden="true" size={14} />
                )}
                选择目录
              </button>
              <button
                className="settings-secondary-button"
                disabled={
                  storageLocationBusy
                  || storageLocation === null
                  || !storageLocation.canChange
                  || (storageLocation.source === "default"
                    && !storageLocation.configurationError
                    && !storageLocation.restartRequired)
                }
                type="button"
                onClick={() => void resetStorageLocation()}
              >
                恢复默认
              </button>
            </div>
          </article>
        </div>
        {storageLocationError === null ? null : (
          <p className="settings-operation-error" role="alert">{storageLocationError}</p>
        )}
      </section>
    </SettingsSectionHeader>
  );
}
