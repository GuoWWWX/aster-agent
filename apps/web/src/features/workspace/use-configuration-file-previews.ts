import { useCallback, useEffect, useRef, useState } from "react";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import type { ConfigurationFilePreviewState, ConfigurationFileTab } from "./sidebar-workspace-types.js";

/** Owns configuration-file drafts and their per-document write queues. */
export function useConfigurationFilePreviews(agentClient: AgentClient) {
  const notifyConfigurationWorkspaceChanged = useWorkbenchUiStore(state => state.notifyConfigurationWorkspaceChanged);
  const [configurationFilePreviews, setConfigurationFilePreviews] = useState<
    Record<string, ConfigurationFilePreviewState>
  >({});
  const configurationFilePreviewsRef = useRef(configurationFilePreviews);
  const configurationSaveQueuesRef = useRef(new Map<string, Promise<boolean>>());
  useEffect(() => {
    configurationFilePreviewsRef.current = configurationFilePreviews;
  }, [configurationFilePreviews]);

  const loadConfigurationFile = useCallback(
    async (tab: ConfigurationFileTab): Promise<void> => {
      setConfigurationFilePreviews((current) => ({
        ...current,
        [tab.id]: {
          draft: current[tab.id]?.draft ?? "",
          error: null,
          file: current[tab.id]?.file ?? null,
          isDirty: current[tab.id]?.isDirty ?? false,
          isLoading: true,
          isSaving: current[tab.id]?.isSaving ?? false,
          savedContent: current[tab.id]?.savedContent ?? "",
        },
      }));
      try {
        const file = await agentClient.readConfigurationWorkspaceFile({
          configurationId: tab.configurationId,
          kind: tab.configurationKind,
          path: tab.path,
        });
        const content = file.content ?? "";
        setConfigurationFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            draft: content,
            error: null,
            file,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: content,
          },
        }));
      } catch (reason) {
        setConfigurationFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            draft: "",
            error: getUserErrorMessage(reason, "无法读取配置文件。"),
            file: null,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: "",
          },
        }));
      }
    },
    [agentClient],
  );

  const queueConfigurationSave = useCallback(
    (tab: ConfigurationFileTab, content: string): Promise<boolean> => {
      const preview = configurationFilePreviewsRef.current[tab.id];
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
      ) {
        return Promise.resolve(true);
      }
      setConfigurationFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : { ...current, [tab.id]: { ...currentPreview, error: null, isSaving: true } };
      });
      const previous = configurationSaveQueuesRef.current.get(tab.id) ?? Promise.resolve(true);
      const operation = previous
        .catch(() => true)
        .then(async () => {
          try {
            const saved = await agentClient.writeConfigurationWorkspaceFile({
              configurationId: tab.configurationId,
              content,
              kind: tab.configurationKind,
              path: tab.path,
            });
            const savedContent = saved.content ?? content;
            setConfigurationFilePreviews((current) => {
              const currentPreview = current[tab.id];
              if (currentPreview === undefined) return current;
              const isCurrentDraft = currentPreview.draft === content;
              const nextDraft = isCurrentDraft ? savedContent : currentPreview.draft;
              return {
                ...current,
                [tab.id]: {
                  ...currentPreview,
                  draft: nextDraft,
                  error: null,
                  file: saved,
                  isDirty: isCurrentDraft ? false : currentPreview.draft !== savedContent,
                  savedContent,
                },
              };
            });
            notifyConfigurationWorkspaceChanged();
            return true;
          } catch (reason) {
            setConfigurationFilePreviews((current) => {
              const currentPreview = current[tab.id];
              return currentPreview === undefined
                ? current
                : {
                    ...current,
                    [tab.id]: {
                      ...currentPreview,
                      error: getUserErrorMessage(reason, "无法保存配置文件。"),
                    },
                  };
            });
            return false;
          }
        })
        .finally(() => {
          if (configurationSaveQueuesRef.current.get(tab.id) !== operation) return;
          setConfigurationFilePreviews((current) => {
            const currentPreview = current[tab.id];
            return currentPreview === undefined
              ? current
              : { ...current, [tab.id]: { ...currentPreview, isSaving: false } };
          });
        });
      configurationSaveQueuesRef.current.set(tab.id, operation);
      return operation;
    },
    [agentClient, notifyConfigurationWorkspaceChanged],
  );

  const flushConfigurationFile = useCallback(
    async (tab: ConfigurationFileTab): Promise<boolean> => {
      const preview = configurationFilePreviewsRef.current[tab.id];
      if (preview?.isDirty === true) return queueConfigurationSave(tab, preview.draft);
      return configurationSaveQueuesRef.current.get(tab.id) ?? true;
    },
    [queueConfigurationSave],
  );

  const updateConfigurationDraft = useCallback((tabId: string, value: string): void => {
    setConfigurationFilePreviews((current) => {
      const preview = current[tabId];
      if (preview === undefined) return current;
      return {
        ...current,
        [tabId]: {
          ...preview,
          draft: value,
          error: null,
          isDirty: value !== preview.savedContent,
        },
      };
    });
  }, []);

  const hasUnsavedConfigurationFile = useCallback((tabId: string): boolean => configurationFilePreviewsRef.current[tabId]?.isDirty === true, []);
  const hasPendingConfigurationFile = useCallback((tabId: string): boolean => {
    const preview = configurationFilePreviewsRef.current[tabId];
    return preview?.isDirty === true || preview?.isSaving === true;
  }, []);
  const forgetConfigurationPreviews = useCallback((tabIds: ReadonlySet<string>): void => {
    setConfigurationFilePreviews(current => Object.fromEntries(Object.entries(current).filter(([tabId]) => !tabIds.has(tabId))));
  }, []);
  return {
    configurationFilePreviews,
    flushConfigurationFile,
    forgetConfigurationPreviews,
    hasPendingConfigurationFile,
    hasUnsavedConfigurationFile,
    loadConfigurationFile,
    updateConfigurationDraft,
  };
}
