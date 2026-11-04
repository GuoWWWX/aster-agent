import { useCallback, useMemo } from "react";
import type { ProjectEntry } from "@agent/protocol";
import type { ProjectTreeController } from "../projects/use-project-tree.js";
import {
  directoryPathForFile,
  isProjectPreviewImagePath,
  projectImageNavigation,
} from "./sidebar-file-model.js";
import type { ConfigurationFileTab, ProjectFileTab } from "./sidebar-workspace-types.js";

/** File navigation waits for the current documents' save guards before switching. */
export function useSidebarFileNavigation({
  activeConfigurationTab,
  activeFileTab,
  flushConfigurationFile,
  flushFileSave,
  openFile,
}: {
  activeConfigurationTab: ConfigurationFileTab | null;
  activeFileTab: ProjectFileTab | null;
  flushConfigurationFile: (tab: ConfigurationFileTab) => Promise<boolean>;
  flushFileSave: (tab: ProjectFileTab) => Promise<boolean>;
  openFile: (entry: ProjectEntry) => void;
}) {
  const openProjectFile = useCallback(async (entry: ProjectEntry): Promise<void> => {
    if (activeConfigurationTab !== null && !await flushConfigurationFile({ ...activeConfigurationTab })) return;
    if (activeFileTab !== null && !await flushFileSave({ ...activeFileTab })) return;
    openFile(entry);
  }, [activeConfigurationTab, activeFileTab, flushConfigurationFile, flushFileSave, openFile]);

  const openProjectFilePath = useCallback(async (path: string): Promise<void> => {
    await openProjectFile({
      kind: "file",
      name: path.replaceAll("\\", "/").split("/").at(-1) ?? path,
      path,
    });
  }, [openProjectFile]);

  return { openProjectFile, openProjectFilePath };
}

export function useProjectImageNavigation(
  path: string | null,
  directories: ProjectTreeController["directories"],
) {
  return useMemo(() => {
    if (path === null || !isProjectPreviewImagePath(path)) return null;
    return projectImageNavigation(directories[directoryPathForFile(path)]?.entries ?? [], path);
  }, [directories, path]);
}
