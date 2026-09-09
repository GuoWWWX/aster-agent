// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  type ProjectSummary,
  type TeamInstanceView,
} from "@agent/protocol";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ProjectNavigator } from "./project-navigator.js";
import { createProjectSession, type ProjectSession } from "./project-session-model.js";
import type { ProjectTreeController } from "./use-project-tree.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
});

describe("ProjectNavigator", () => {
  it("shows the archive shortcut immediately before more and preserves its action", () => {
    const project = createProject();
    const session = createProjectSession(project.id, [], "archive-session");
    const onSetSessionArchived = vi.fn().mockResolvedValue(true);
    const onSelectSession = vi.fn();
    const container = renderNavigator(project, [session], { onSetSessionArchived, onSelectSession });
    const more = container.querySelector(`[aria-label="更多 ${session.title}"]`)!;
    const archive = more.previousElementSibling as HTMLButtonElement;
    expect(archive.getAttribute("aria-label")).toBe(`归档 ${session.title}`);
    expect(archive.disabled).toBe(false);
    act(() => archive.click());
    expect(onSetSessionArchived).toHaveBeenCalledWith(session.id, true);
    expect(onSelectSession).not.toHaveBeenCalled();
  });
  it("opens the target project directory and displays a dismissible failure", async () => {
    const project = createProject();
    const onOpenProjectDirectory = vi.fn().mockRejectedValue(new Error("missing"));
    const container = renderNavigator(project, [], { onOpenProjectDirectory });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="更多 Demo"]')?.click());
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent === "在资源管理器打开")?.click();
      await Promise.resolve();
    });
    expect(onOpenProjectDirectory).toHaveBeenCalledWith(project.id);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("无法打开项目目录");
    act(() => container.querySelector<HTMLButtonElement>('[role="status"] button')?.click());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it("groups project actions in the rightmost menu and copies the root path", async () => {
    const project = createProject();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const browserWriteText = vi.fn().mockRejectedValue(new Error("Write permission denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWriteText } });
    const container = renderNavigator(project, [], { onCopyText: writeText });
    const actions = container.querySelector('[aria-label="更多 Demo"]')!.parentElement!;
    expect(actions.lastElementChild?.getAttribute("aria-label")).toBe("更多 Demo");
    expect(container.querySelector('[aria-label="在 Demo 中创建团队"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="更多 Demo"]')?.click());
    const menu = document.querySelector('[role="menu"]')!;
    for (const label of ["创建团队", "重命名", "复制项目路径", "在资源管理器打开", "移除项目"]) {
      expect(menu.textContent).toContain(label);
    }
    await act(async () => {
      Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "复制项目路径")?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(project.rootPath);
    expect(browserWriteText).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens conversation team creation from more without selecting the conversation", () => {
    const project = createProject();
    const session = createProjectSession(project.id, [], "menu-session");
    const container = renderNavigator(project, [session]);
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="更多 ${session.title}"]`)?.click());
    const menu = document.querySelector('[role="menu"]')!;
    for (const label of ["创建团队", "重命名", "置顶", "归档", "删除对话"]) expect(menu.textContent).toContain(label);
    const more = container.querySelector(`[aria-label="更多 ${session.title}"]`)!;
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.closest(".project-navigator__session-shell")?.getAttribute("data-menu-open")).toBe("true");
    act(() => Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "创建团队")?.click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("创建对话团队");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
  it("defaults the temporary group to collapsed", () => {
    const project = createProject();
    const temporarySession = createProjectSession(null, [], "temporary-conversation");
    const container = renderNavigator(project, [temporarySession]);

    expect(container.querySelector('button[aria-label="展开 临时"]')).not.toBeNull();
    expect(container.querySelector(`[data-navigator-key="session:${temporarySession.id}"]`)).toBeNull();
  });

  it("restores group and project disclosure after the navigator remounts", () => {
    const project = createProject();
    const projectSession = createProjectSession(project.id, [], "project-conversation");
    const temporarySession = createProjectSession(null, [], "temporary-conversation");
    let container = renderNavigator(project, [projectSession, temporarySession]);

    const collapseAll = container.querySelector<HTMLButtonElement>(
      'button[aria-label="全部收起项目与对话"]',
    );
    act(() => collapseAll?.click());

    expect(container.querySelector('button[aria-label="展开 项目"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开 团队"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开 临时"]')).not.toBeNull();

    act(() => root?.unmount());
    root = null;
    container.remove();
    container = renderNavigator(project, [projectSession, temporarySession]);

    expect(container.querySelector('button[aria-label="展开 项目"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开 团队"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="展开 临时"]')).not.toBeNull();

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开 项目"]')?.click());
    expect(container.querySelector(`button[aria-label="展开 ${project.name}"]`)).not.toBeNull();
  });

  it("keeps Subagents out of the conversation tree while retaining conversation teams", () => {
    const project = createProject();
    const parent: ProjectSession = {
      ...createProjectSession(project.id, [], "parent-conversation"),
      title: "父对话",
    };
    const child: ProjectSession = {
      ...createProjectSession(project.id, [parent], "child-agent"),
      agentId: "explorer",
      parentConversationId: parent.id,
      threadKind: "subagent",
      title: "子智能体",
    };
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const teamInstance: TeamInstanceView = {
      createdAt: "2026-09-03T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
      isArchived: false,
      name: "对话团队",
      projectId: project.id,
      rootConversationId: null,
      scope: "conversation",
      sourceConversationId: parent.id,
      teamId: team.id,
      updatedAt: "2026-09-03T00:00:00.000Z",
    };
    const onSetTeamInstanceArchived = vi.fn(() => Promise.resolve(true));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TooltipProvider>
        <ProjectNavigator
          activeSessionId={parent.id}
          agents={DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents}
          isCreatingSession={false}
          isLoadingSessions={false}
          locateRequest={null}
          operationError={null}
          sessions={[parent, child]}
          teamInstances={[teamInstance]}
          teams={[team]}
          teamWorkItems={[]}
          tree={createTreeController(project)}
         onClearOperationError={() => undefined}
          onCopyText={() => Promise.resolve()}
          onCreateProjectSession={() => undefined}
          onCreateTeamInstance={() => Promise.resolve(true)}
          onCreateTemporarySession={() => undefined}
          onDeleteSession={() => Promise.resolve(true)}
          onDeleteTeamInstance={() => Promise.resolve(true)}
          onOpenTeamMember={() => undefined}
          onRemoveProject={() => Promise.resolve(true)}
          onRenameProject={() => Promise.resolve(true)}
          onRenameSession={() => Promise.resolve(true)}
          onRenameTeamInstance={() => Promise.resolve(true)}
          onReorderSessions={() => Promise.resolve(true)}
          onReorderTeamInstances={() => Promise.resolve(true)}
          onSelectProject={() => undefined}
          onSelectSession={() => undefined}
          onSetSessionArchived={() => Promise.resolve(true)}
          onSetSessionPinned={() => Promise.resolve(true)}
          onSetTeamInstanceArchived={onSetTeamInstanceArchived}
        />
      </TooltipProvider>,
    ));

    const expandButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开 父对话 的对话团队"]',
    );
    act(() => expandButton?.click());

    const archiveTeamButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="归档团队 对话团队"]',
    );
    expect(container.querySelector(`[data-navigator-key="session:${child.id}"]`)).toBeNull();
    expect(container.textContent).not.toContain("子智能体");
    expect(archiveTeamButton).not.toBeNull();

    act(() => archiveTeamButton?.click());

    expect(onSetTeamInstanceArchived).toHaveBeenCalledWith(teamInstance.id, true);
  });
});

function createTreeController(project: ProjectSummary): ProjectTreeController {
  return {
    activeProject: project,
    allDirectoriesCollapsed: true,
    canAddProjects: true,
    directories: {},
    expandedDirectories: new Set(),
    isAddingProject: false,
    isLoadingProjects: false,
    locatedPath: null,
    locateRequestId: 0,
    operationError: null,
    projects: [project],
    query: "",
    rootDirectoryState: undefined,
    rootEntries: [],
    selectedPath: null,
    addProject: () => Promise.resolve(null),
    clearOperationError: () => undefined,
    collapseAllDirectories: () => undefined,
    createEntry: () => Promise.resolve(null),
    expandAllDirectories: () => undefined,
    locatePath: () => undefined,
    refresh: () => undefined,
    reloadDirectory: () => undefined,
    removeProject: () => Promise.resolve(true),
    renameProject: () => Promise.resolve(true),
    reorderProjects: () => Promise.resolve(true),
    selectPath: () => undefined,
    selectProject: () => undefined,
    setProjectPinned: () => Promise.resolve(true),
    setProjectTeamsInNavigator: () => Promise.resolve(true),
    setQuery: () => undefined,
    toggleDirectory: () => undefined,
  };
}

function createProject(): ProjectSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    isPinned: false,
    name: "Demo",
    rootPath: "D:\\workspace\\demo",
  };
}

function renderNavigator(
  project: ProjectSummary,
  sessions: ProjectSession[],
  overrides: Partial<Parameters<typeof ProjectNavigator>[0]> = {},
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(
    <TooltipProvider>
      <ProjectNavigator
        activeSessionId={sessions.find((session) => session.projectId === project.id)?.id ?? null}
        agents={DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents}
        isCreatingSession={false}
        isLoadingSessions={false}
        locateRequest={null}
        operationError={null}
        sessions={sessions}
        teamInstances={[]}
        teams={DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams}
        teamWorkItems={[]}
        tree={createTreeController(project)}
       onClearOperationError={() => undefined}
        onCopyText={() => Promise.resolve()}
        onCreateProjectSession={() => undefined}
        onCreateTeamInstance={() => Promise.resolve(true)}
        onCreateTemporarySession={() => undefined}
        onDeleteSession={() => Promise.resolve(true)}
        onDeleteTeamInstance={() => Promise.resolve(true)}
        onOpenTeamMember={() => undefined}
        onRemoveProject={() => Promise.resolve(true)}
        onRenameProject={() => Promise.resolve(true)}
        onRenameSession={() => Promise.resolve(true)}
        onRenameTeamInstance={() => Promise.resolve(true)}
        onReorderSessions={() => Promise.resolve(true)}
        onReorderTeamInstances={() => Promise.resolve(true)}
        onSelectProject={() => undefined}
        onSelectSession={() => undefined}
        onSetSessionArchived={() => Promise.resolve(true)}
        onSetSessionPinned={() => Promise.resolve(true)}
        onSetTeamInstanceArchived={() => Promise.resolve(true)}
        {...overrides}
      />
    </TooltipProvider>,
  ));
  return container;
}
