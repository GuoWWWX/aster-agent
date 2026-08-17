import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectSummary,
} from "@agent/protocol";

import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  filterProjectEntries,
  ROOT_DIRECTORY_PATH,
  type DirectoryStates,
} from "./project-tree-model.js";

export type ProjectTreeController = {
  activeProject: ProjectSummary | null;
  allDirectoriesCollapsed: boolean;
  canAddProjects: boolean;
  directories: DirectoryStates;
  expandedDirectories: ReadonlySet<string>;
  isAddingProject: boolean;
  isLoadingProjects: boolean;
  locatedPath: string | null;
  locateRequestId: number;
  operationError: string | null;
  projects: ProjectSummary[];
  query: string;
  rootDirectoryState: DirectoryStates[string];
  rootEntries: ReturnType<typeof filterProjectEntries>;
  selectedPath: string | null;
  addProject(): Promise<ProjectSummary | null>;
  clearOperationError(): void;
  collapseAllDirectories(): void;
  expandAllDirectories(): void;
  createEntry(
    kind: "directory" | "file",
    directoryPath: string,
    name: string,
  ): Promise<ProjectEntry | null>;
  refresh(): void;
  reloadDirectory: (directoryPath: string) => void;
  locatePath(path: string, expandTarget?: boolean): void;
  removeProject(projectId: string): Promise<boolean>;
  reorderProjects(projectIds: string[]): Promise<boolean>;
  renameProject(projectId: string, name: string): Promise<boolean>;
  setProjectPinned(projectId: string, pinned: boolean): Promise<boolean>;
  selectPath(path: string): void;
  selectProject(projectId: string): void;
  setQuery(query: string): void;
  toggleDirectory(directoryPath: string): void;
};

const EXPAND_DIRECTORY_BATCH_SIZE = 16;

function ancestorDirectoryPaths(path: string, includeTarget: boolean): string[] {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const pathCount = includeTarget ? segments.length : Math.max(0, segments.length - 1);
  return Array.from({ length: pathCount }, (_, index) =>
    segments.slice(0, index + 1).join("/"),
  );
}

export function useProjectTree(
  agentClient: AgentClient,
): ProjectTreeController {
  const activeProjectIdRef = useRef<string | null>(null);
  const expandAllRequestIdRef = useRef(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [canAddProjects, setCanAddProjects] = useState(false);
  const [directories, setDirectories] = useState<DirectoryStates>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  );
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [locatedPath, setLocatedPath] = useState<string | null>(null);
  const [locateRequestId, setLocateRequestId] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const loadDirectory = useCallback(
    async (
      projectId: string,
      directoryPath: string,
    ): Promise<ProjectDirectoryListing | null> => {
      setDirectories((current) => ({
        ...current,
        [directoryPath]: {
          entries: current[directoryPath]?.entries ?? [],
          errorMessage: null,
          isLoading: true,
          truncated: false,
        },
      }));

      try {
        const listing = await agentClient.listProjectEntries({
          directoryPath,
          projectId,
        });

        if (activeProjectIdRef.current !== projectId) {
          return null;
        }

        setDirectories((current) => ({
          ...current,
          [directoryPath]: {
            entries: listing.entries,
            errorMessage: null,
            isLoading: false,
            truncated: listing.truncated,
          },
        }));
        return listing;
      } catch (error) {
        if (activeProjectIdRef.current !== projectId) {
          return null;
        }

        setDirectories((current) => ({
          ...current,
          [directoryPath]: {
            entries: current[directoryPath]?.entries ?? [],
            errorMessage: getUserErrorMessage(error, "无法读取目录"),
            isLoading: false,
            truncated: false,
          },
        }));
        return null;
      }
    },
    [agentClient],
  );

  useEffect(() => {
    let disposed = false;

    void Promise.all([
      agentClient.getCapabilities(),
      agentClient.listProjects(),
    ])
      .then(([capabilities, initialProjects]) => {
        if (disposed) {
          return;
        }

        setCanAddProjects(capabilities.workspace);
        setProjects(initialProjects);
        setActiveProjectId((current) => current ?? initialProjects[0]?.id ?? null);
      })
      .catch(() => {
        if (!disposed) {
          setOperationError("无法加载项目列表");
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoadingProjects(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [agentClient]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (activeProjectId === null) {
      setDirectories({});
      return;
    }

    setDirectories({});
    setExpandedDirectories(new Set());
    expandAllRequestIdRef.current += 1;
    setLocatedPath(null);
    setQuery("");
    setSelectedPath(null);
    void loadDirectory(activeProjectId, ROOT_DIRECTORY_PATH);
  }, [activeProjectId, loadDirectory]);

  const addProject = useCallback(async (): Promise<ProjectSummary | null> => {
    if (!canAddProjects || isAddingProject) {
      return null;
    }

    setIsAddingProject(true);
    setOperationError(null);

    try {
      const project = await agentClient.addProject();
      if (project === null) {
        return null;
      }

      setProjects((current) => {
        const existingIndex = current.findIndex(
          (candidate) => candidate.id === project.id,
        );

        if (existingIndex < 0) {
          return [...current, project];
        }

        return current.map((candidate) =>
          candidate.id === project.id ? project : candidate,
        );
      });
      setActiveProjectId(project.id);
      return project;
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "添加项目失败"));
      return null;
    } finally {
      setIsAddingProject(false);
    }
  }, [agentClient, canAddProjects, isAddingProject]);

  const renameProject = useCallback(async (
    projectId: string,
    name: string,
  ): Promise<boolean> => {
    setOperationError(null);
    try {
      const project = await agentClient.renameProject({ name, projectId });
      setProjects((current) =>
        current.map((candidate) => candidate.id === project.id ? project : candidate),
      );
      return true;
    } catch {
      setOperationError("无法重命名项目");
      return false;
    }
  }, [agentClient]);

  const reorderProjects = useCallback(async (projectIds: string[]): Promise<boolean> => {
    setOperationError(null);
    try {
      setProjects(await agentClient.reorderProjects({ projectIds }));
      return true;
    } catch {
      setOperationError("无法调整项目顺序");
      return false;
    }
  }, [agentClient]);

  const setProjectPinned = useCallback(async (
    projectId: string,
    pinned: boolean,
  ): Promise<boolean> => {
    setOperationError(null);
    try {
      const project = await agentClient.setProjectPinned({ pinned, projectId });
      setProjects((current) =>
        current.map((candidate) => candidate.id === project.id ? project : candidate),
      );
      return true;
    } catch {
      setOperationError("无法修改项目置顶状态");
      return false;
    }
  }, [agentClient]);

  const removeProject = useCallback(async (projectId: string): Promise<boolean> => {
    setOperationError(null);
    try {
      await agentClient.removeProject({ projectId });
      const remainingProjects = projects.filter((project) => project.id !== projectId);
      setProjects(remainingProjects);
      if (activeProjectId === projectId) {
        setActiveProjectId(remainingProjects[0]?.id ?? null);
      }
      return true;
    } catch {
      setOperationError("无法移除项目");
      return false;
    }
  }, [activeProjectId, agentClient, projects]);

  const refresh = useCallback((): void => {
    if (activeProjectId === null) {
      return;
    }

    setDirectories({});
    setExpandedDirectories(new Set());
    expandAllRequestIdRef.current += 1;
    setLocatedPath(null);
    setSelectedPath(null);
    void loadDirectory(activeProjectId, ROOT_DIRECTORY_PATH);
  }, [activeProjectId, loadDirectory]);

  const reloadDirectory = useCallback(
    (directoryPath: string): void => {
      if (activeProjectId !== null) {
        void loadDirectory(activeProjectId, directoryPath);
      }
    },
    [activeProjectId, loadDirectory],
  );

  const createEntry = useCallback(async (
    kind: "directory" | "file",
    directoryPath: string,
    name: string,
  ): Promise<ProjectEntry | null> => {
    if (activeProjectId === null) return null;
    const normalizedName = name.trim();
    if (
      normalizedName.length === 0
      || normalizedName === "."
      || normalizedName === ".."
      || normalizedName.includes("/")
      || normalizedName.includes("\\")
    ) {
      setOperationError("名称不能包含路径分隔符");
      return null;
    }
    const entryPath = directoryPath.length === 0
      ? normalizedName
      : `${directoryPath}/${normalizedName}`;
    setOperationError(null);
    try {
      const entry = await agentClient.createProjectEntry({
        kind,
        path: entryPath,
        projectId: activeProjectId,
      });
      await loadDirectory(activeProjectId, directoryPath);
      if (directoryPath.length > 0) {
        setExpandedDirectories((current) => new Set(current).add(directoryPath));
      }
      setSelectedPath(entry.path);
      setLocatedPath(entry.path);
      setLocateRequestId((current) => current + 1);
      return entry;
    } catch {
      setOperationError(kind === "file" ? "无法新建文件" : "无法新建文件夹");
      return null;
    }
  }, [activeProjectId, agentClient, loadDirectory]);

  const expandAllDirectories = useCallback((): void => {
    if (activeProjectId === null) return;
    const rootEntries = directories[ROOT_DIRECTORY_PATH]?.entries ?? [];
    const queue = rootEntries
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path);
    if (queue.length === 0) return;

    const projectId = activeProjectId;
    const requestId = expandAllRequestIdRef.current + 1;
    expandAllRequestIdRef.current = requestId;
    const visited = new Set<string>();
    const initiallyKnownDirectories = Object.values(directories)
      .flatMap((directory) => directory?.entries ?? [])
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path);
    setExpandedDirectories(new Set(initiallyKnownDirectories));

    void (async () => {
      while (
        queue.length > 0
        && activeProjectIdRef.current === projectId
        && expandAllRequestIdRef.current === requestId
      ) {
        const batch: string[] = [];
        while (batch.length < EXPAND_DIRECTORY_BATCH_SIZE && queue.length > 0) {
          const directoryPath = queue.shift();
          if (directoryPath !== undefined && !visited.has(directoryPath)) {
            visited.add(directoryPath);
            batch.push(directoryPath);
          }
        }
        if (batch.length === 0) continue;

        const listings = await Promise.all(
          batch.map((directoryPath) => {
            const cached = directories[directoryPath];
            if (cached !== undefined && !cached.isLoading && cached.errorMessage === null) {
              return Promise.resolve({
                directoryPath,
                entries: cached.entries,
                projectId,
                truncated: cached.truncated,
              });
            }
            return loadDirectory(projectId, directoryPath);
          }),
        );
        if (expandAllRequestIdRef.current !== requestId) return;

        const discoveredDirectories: string[] = [];
        for (const listing of listings) {
          for (const entry of listing?.entries ?? []) {
            if (entry.kind === "directory" && !visited.has(entry.path)) {
              queue.push(entry.path);
              discoveredDirectories.push(entry.path);
            }
          }
        }
        if (discoveredDirectories.length > 0) {
          setExpandedDirectories((current) => {
            const next = new Set(current);
            for (const directoryPath of discoveredDirectories) next.add(directoryPath);
            return next;
          });
        }
      }
    })();
  }, [activeProjectId, directories, loadDirectory]);

  const collapseAllDirectories = useCallback((): void => {
    expandAllRequestIdRef.current += 1;
    setExpandedDirectories(new Set());
  }, []);

  const toggleDirectory = useCallback(
    (directoryPath: string): void => {
      if (activeProjectId === null) {
        return;
      }

      const isExpanded = expandedDirectories.has(directoryPath);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.delete(directoryPath);
        } else {
          next.add(directoryPath);
        }
        return next;
      });

      const directoryState = directories[directoryPath];
      if (!isExpanded && (directoryState === undefined || directoryState.errorMessage)) {
        void loadDirectory(activeProjectId, directoryPath);
      }
    },
    [activeProjectId, directories, expandedDirectories, loadDirectory],
  );

  const locatePath = useCallback(
    (path: string, expandTarget = false): void => {
      const ancestorPaths = ancestorDirectoryPaths(path, expandTarget);
      setQuery("");
      setLocatedPath(path);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        for (const ancestorPath of ancestorPaths) next.add(ancestorPath);
        return next;
      });
      setLocateRequestId((current) => current + 1);

      if (activeProjectId !== null) {
        for (const ancestorPath of ancestorPaths) {
          if (directories[ancestorPath] === undefined) {
            void loadDirectory(activeProjectId, ancestorPath);
          }
        }
      }
    },
    [activeProjectId, directories, loadDirectory],
  );

  useEffect(() => {
    if (locatedPath === null) return undefined;
    const timeout = window.setTimeout(() => setLocatedPath(null), 1_500);
    return () => window.clearTimeout(timeout);
  }, [locateRequestId, locatedPath]);

  const rootDirectoryState = directories[ROOT_DIRECTORY_PATH];

  return {
    activeProject,
    addProject,
    allDirectoriesCollapsed: expandedDirectories.size === 0,
    canAddProjects,
    clearOperationError: () => setOperationError(null),
    collapseAllDirectories,
    createEntry,
    directories,
    expandAllDirectories,
    expandedDirectories,
    isAddingProject,
    isLoadingProjects,
    locatedPath,
    locatePath,
    locateRequestId,
    operationError,
    projects,
    query,
    refresh,
    removeProject,
    reorderProjects,
    reloadDirectory,
    rootDirectoryState,
    rootEntries: filterProjectEntries(rootDirectoryState?.entries ?? [], query),
    renameProject,
    selectPath: setSelectedPath,
    selectProject: setActiveProjectId,
    selectedPath,
    setProjectPinned,
    setQuery,
    toggleDirectory,
  };
}
