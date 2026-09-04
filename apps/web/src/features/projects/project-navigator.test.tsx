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

  it("archives idle Agent and Team children from their hover action rows", () => {
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
    const onSetSessionArchived = vi.fn(() => Promise.resolve(true));
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
          onSetSessionArchived={onSetSessionArchived}
          onSetSessionPinned={() => Promise.resolve(true)}
          onSetTeamInstanceArchived={onSetTeamInstanceArchived}
        />
      </TooltipProvider>,
    ));

    const expandButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开 父对话 的协作成员"]',
    );
    act(() => expandButton?.click());

    const archiveAgentButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="归档 子智能体"]',
    );
    const archiveTeamButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="归档团队 对话团队"]',
    );
    expect(archiveAgentButton).not.toBeNull();
    expect(archiveTeamButton).not.toBeNull();

    act(() => archiveAgentButton?.click());
    act(() => archiveTeamButton?.click());

    expect(onSetSessionArchived).toHaveBeenCalledWith(child.id, true);
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
      />
    </TooltipProvider>,
  ));
  return container;
}
