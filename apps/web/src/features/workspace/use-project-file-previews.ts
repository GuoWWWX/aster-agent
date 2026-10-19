import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectFile } from "@agent/protocol";
import { setImageSourceResolver } from "../../components/editor/cm/image-source-resolver.js";
import { resolveBrowserPreviewImage } from "../../lib/browser-preview-images.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import type { ProjectTreeController } from "../projects/use-project-tree.js";
import { getGitReviewCache } from "./git-review-cache.js";
import { directoryPathForFile, isProjectPreviewImagePath, saveConflictFor } from "./sidebar-file-model.js";
import type { FilePreviewState, FileTab, ProjectFileTab } from "./sidebar-workspace-types.js";

/** Owns project-file snapshots, serialized saves and stale/locked-file conflicts. */
export function useProjectFilePreviews({
  agentClient,
  activeProjectId,
  fileTabs,
  reloadProjectDirectory,
}: {
  agentClient: AgentClient;
  activeProjectId: string | undefined;
  fileTabs: readonly FileTab[];
  reloadProjectDirectory: ProjectTreeController["reloadDirectory"];
}) {
  const gitReviewCache = getGitReviewCache(agentClient);
  const [filePreviews, setFilePreviews] = useState<Record<string, FilePreviewState>>({});
  const filePreviewsRef = useRef(filePreviews);
  const fileSaveQueuesRef = useRef(new Map<string, Promise<boolean>>());
  const fileLoadRequestIdsRef = useRef(new Map<string, number>());
  useEffect(() => {
    filePreviewsRef.current = filePreviews;
  }, [filePreviews]);

  useEffect(() => {
    const projectId = activeProjectId;
    const resolver = async (source: string, sourcePath?: string): Promise<string | null | undefined> => {
      if (/^(?:https?:|data:|blob:)/iu.test(source)) return source;
      if (projectId === undefined || sourcePath === undefined) {
        return resolveBrowserPreviewImage(source, sourcePath);
      }
      try {
        const image = await agentClient.readProjectPreviewImage({
          path: source,
          projectId,
          sourcePath,
        });
        return `data:${image.mimeType};base64,${image.data}`;
      } catch {
        return resolveBrowserPreviewImage(source, sourcePath);
      }
    };
    return setImageSourceResolver(resolver);
  }, [activeProjectId, agentClient]);

  const loadFile = useCallback(
    async (tab: ProjectFileTab): Promise<void> => {
      const requestId = (fileLoadRequestIdsRef.current.get(tab.id) ?? 0) + 1;
      fileLoadRequestIdsRef.current.set(tab.id, requestId);
      setFilePreviews((current) => ({
        ...current,
        [tab.id]: {
          contentRevision: current[tab.id]?.contentRevision ?? 0,
          conflict: current[tab.id]?.conflict ?? null,
          draft: current[tab.id]?.draft ?? "",
          error: null,
          file: current[tab.id]?.file ?? null,
          imageDataUrl: current[tab.id]?.imageDataUrl ?? null,
          isDirty: current[tab.id]?.isDirty ?? false,
          isLoading: true,
          isSaving: current[tab.id]?.isSaving ?? false,
          savedContent: current[tab.id]?.savedContent ?? "",
        },
      }));
      try {
        if (isProjectPreviewImagePath(tab.path)) {
          const image = await agentClient.readProjectPreviewImage({
            path: tab.name,
            projectId: tab.projectId,
            sourcePath: tab.path,
          });
          if (fileLoadRequestIdsRef.current.get(tab.id) !== requestId) return;
          setFilePreviews((current) => ({
            ...current,
            [tab.id]: {
              contentRevision: current[tab.id]?.contentRevision ?? 0,
              conflict: null,
              draft: "",
              error: null,
              file: null,
              imageDataUrl: `data:${image.mimeType};base64,${image.data}`,
              isDirty: false,
              isLoading: false,
              isSaving: false,
              savedContent: "",
            },
          }));
          return;
        }
        const file = await agentClient.readProjectFile({
          path: tab.path,
          projectId: tab.projectId,
        });
        if (fileLoadRequestIdsRef.current.get(tab.id) !== requestId) return;
        setFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            contentRevision: (current[tab.id]?.contentRevision ?? 0) + 1,
            conflict: null,
            draft: file.content ?? "",
            error: null,
            file,
            imageDataUrl: null,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: file.content ?? "",
          },
        }));
      } catch (reason) {
        if (fileLoadRequestIdsRef.current.get(tab.id) !== requestId) return;
        setFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            contentRevision: current[tab.id]?.contentRevision ?? 0,
            conflict: null,
            draft: "",
            error: getUserErrorMessage(
              reason,
              isProjectPreviewImagePath(tab.path) ? "无法预览图片" : "无法读取文件",
            ),
            file: null,
            imageDataUrl: null,
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

  const refreshFileChangeTargets = useCallback(
    (projectId: string, changedPath: string, savedFile?: ProjectFile): void => {
      reloadProjectDirectory(directoryPathForFile(changedPath));
      for (const tab of fileTabs) {
        if (tab.kind !== "file" || tab.projectId !== projectId || tab.path !== changedPath) continue;
        if (savedFile !== undefined) {
          setFilePreviews((current) => {
            const preview = current[tab.id];
            if (preview === undefined) return current;
            const savedContent = savedFile.content ?? "";
            const isCurrentDraft = preview.draft === savedContent;
            return {
              ...current,
              [tab.id]: {
                ...preview,
                conflict: null,
                draft: isCurrentDraft ? savedContent : preview.draft,
                error: null,
                file: savedFile,
                isDirty: !isCurrentDraft,
                savedContent,
              },
            };
          });
          continue;
        }

        const preview = filePreviewsRef.current[tab.id];
        if (preview?.isDirty === true) {
          setFilePreviews((current) => {
            const currentPreview = current[tab.id];
            return currentPreview === undefined
              ? current
              : {
                ...current,
                [tab.id]: { ...currentPreview, conflict: "stale", error: null },
              };
          });
        } else {
          void loadFile(tab);
        }
      }
    },
    [fileTabs, loadFile, reloadProjectDirectory],
  );

  const queueFileSave = useCallback(
    (tab: ProjectFileTab, content: string, expectedContentOverride?: string | null): Promise<boolean> => {
      const preview = filePreviewsRef.current[tab.id];
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
      ) {
        return Promise.resolve(true);
      }

      const existing = fileSaveQueuesRef.current.get(tab.id);
      if (preview.isSaving && existing !== undefined) return existing;

      setFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : { ...current, [tab.id]: { ...currentPreview, error: null, isSaving: true } };
      });

      const previous = existing ?? Promise.resolve(true);
      const operation = previous
        .catch(() => true)
        .then(async () => {
          try {
            const currentPreview = filePreviewsRef.current[tab.id];
            const expectedContent = expectedContentOverride
              ?? currentPreview?.savedContent
              ?? preview.savedContent;
            const saved = await agentClient.writeProjectFile({
              content,
              expectedContent,
              path: tab.path,
              projectId: tab.projectId,
            });
            setFilePreviews((current) => {
              const latest = current[tab.id];
              if (latest === undefined) return current;
              const isCurrentDraft = latest.draft === content;
              const savedContent = saved.content ?? content;
              return {
                ...current,
                [tab.id]: {
                  ...latest,
                  conflict: null,
                  draft: isCurrentDraft ? savedContent : latest.draft,
                  error: null,
                  file: saved,
                  isDirty: !isCurrentDraft,
                  savedContent,
                },
              };
            });
            refreshFileChangeTargets(tab.projectId, tab.path, saved);
            return true;
          } catch (reason) {
            const conflict = saveConflictFor(reason);
            setFilePreviews((current) => {
              const latest = current[tab.id];
              if (latest === undefined) return current;
              return {
                ...current,
                [tab.id]: {
                  ...latest,
                  conflict,
                  error: conflict === null
                    ? getUserErrorMessage(reason, "无法保存文件。")
                    : null,
                },
              };
            });
            return false;
          }
        })
        .finally(() => {
          if (fileSaveQueuesRef.current.get(tab.id) !== operation) return;
          setFilePreviews((current) => {
            const latest = current[tab.id];
            return latest === undefined
              ? current
              : { ...current, [tab.id]: { ...latest, isSaving: false } };
          });
        });
      fileSaveQueuesRef.current.set(tab.id, operation);
      return operation;
    },
    [agentClient, refreshFileChangeTargets],
  );

  const flushFileSave = useCallback(
    async (
      tab: ProjectFileTab,
      expectedContentOverride?: string | null,
      contentOverride?: string,
    ): Promise<boolean> => {
      let preview = filePreviewsRef.current[tab.id];
      if (preview !== undefined && contentOverride !== undefined) {
        const nextPreview: FilePreviewState = {
          ...preview,
          draft: contentOverride,
          error: null,
          isDirty: contentOverride !== preview.savedContent,
        };
        // Keep the ref current before queueFileSave reads it; React state updates are
        // asynchronous and a fast Ctrl+S must not wait for a render to see the text.
        filePreviewsRef.current = { ...filePreviewsRef.current, [tab.id]: nextPreview };
        setFilePreviews((current) => {
          const currentPreview = current[tab.id];
          return currentPreview === undefined
            ? current
            : { ...current, [tab.id]: { ...currentPreview, draft: contentOverride, error: null, isDirty: contentOverride !== currentPreview.savedContent } };
        });
        preview = nextPreview;
      }
      const existing = fileSaveQueuesRef.current.get(tab.id);
      if (preview?.isSaving === true && existing !== undefined) return existing;
      const content = contentOverride ?? preview?.draft;
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
        || content === undefined
        || content === preview.savedContent
      ) {
        return existing ?? true;
      }
      return queueFileSave(tab, content, expectedContentOverride);
    },
    [queueFileSave],
  );

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      if (
        event.type !== "tool.completed"
        || event.fileChange == null
      ) {
        return;
      }

      gitReviewCache.noteFileChange(event.fileChange.projectId, event.fileChange.path);
      if (event.fileChange.projectId !== activeProjectId) return;
      refreshFileChangeTargets(event.fileChange.projectId, event.fileChange.path);
    });
  }, [activeProjectId, agentClient, gitReviewCache, refreshFileChangeTargets]);

  const updateFileDraft = useCallback((tabId: string, value: string): void => {
    setFilePreviews((current) => {
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
  const markFileDirty = useCallback((tabId: string, content: string): void => {
    const currentPreview = filePreviewsRef.current[tabId];
    if (currentPreview === undefined) return;
    const nextPreview: FilePreviewState = {
      ...currentPreview,
      draft: content,
      error: null,
      isDirty: content !== currentPreview.savedContent,
    };
    filePreviewsRef.current = {
      ...filePreviewsRef.current,
      [tabId]: nextPreview,
    };
    setFilePreviews((current) => {
      const preview = current[tabId];
      if (preview === undefined) return current;
      return {
        ...current,
        [tabId]: {
          ...preview,
          draft: content,
          error: null,
          isDirty: content !== preview.savedContent,
        },
      };
    });
  }, []);
  const overwriteFile = useCallback(async (tab: ProjectFileTab): Promise<void> => {
    const preview = filePreviewsRef.current[tab.id];
    if (preview?.file === null || preview?.file === undefined) return;
    try {
      const latest = await agentClient.readProjectFile({
        path: tab.path,
        projectId: tab.projectId,
      });
      if (
        latest.content === null
        || latest.isBinary
        || latest.truncated
      ) {
        setFilePreviews((current) => {
          const currentPreview = current[tab.id];
          return currentPreview === undefined
            ? current
            : {
              ...current,
              [tab.id]: {
                ...currentPreview,
                conflict: "stale",
                error: "文件过大或不可安全覆盖，请重新加载。",
              },
            };
        });
        return;
      }
      setFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : {
            ...current,
            [tab.id]: {
              ...currentPreview,
              conflict: null,
              error: null,
              file: latest,
              savedContent: latest.content ?? "",
            },
          };
      });
      await flushFileSave(tab, latest.content);
    } catch (reason) {
      setFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : {
            ...current,
            [tab.id]: {
              ...currentPreview,
              conflict: saveConflictFor(reason),
              error: getUserErrorMessage(reason, "无法读取最新文件。"),
            },
          };
      });
    }
  }, [agentClient, flushFileSave]);

  const hasFilePreview = useCallback((tabId: string): boolean => filePreviewsRef.current[tabId] !== undefined, []);
  return { filePreviews, flushFileSave, hasFilePreview, loadFile, markFileDirty, overwriteFile, updateFileDraft };
}
