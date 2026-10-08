// @vitest-environment jsdom

import { act, useEffect, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockAgentClient } from "../../runtime/index.js";
import { PROJECT_NAVIGATOR_WIDTH_RANGE, useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AppShell } from "./app-shell.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useWorkbenchUiStore.setState({
    activeActivity: "conversations",
    filePanelOpenByConversationId: {},
    filePanelWidth: 520,
    filePanelWidthsByConversationId: {},
    isFilePanelOpen: true,
    isProjectNavigatorOpen: true,
    isSettingsFilePanelOpen: false,
    settingsSection: "general",
    themeMode: "light",
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
});

describe("AppShell", () => {
  it("keeps the right toggle visible but disabled when the page has no right workspace", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<TooltipProvider><AppShell agentClient={new MockAgentClient()}
      filePanel={null} mainContent={null} projectNavigator={null} /></TooltipProvider>));
    const toggle = () => container.querySelector<HTMLButtonElement>('[aria-label="展开右侧工作区"]');
    expect(toggle()?.disabled).toBe(true);
    act(() => useWorkbenchUiStore.getState().setActiveActivity("settings"));
    expect(toggle()?.disabled).toBe(true);
    act(() => useWorkbenchUiStore.getState().setActiveActivity("team"));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="收起右侧工作区"]')?.disabled).toBe(false);
  });
  it("temporarily reveals the collapsed navigator on edge hover without changing the saved layout", () => {
    vi.useFakeTimers();
    try {
      useWorkbenchUiStore.setState({ isProjectNavigatorOpen: false });
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      act(() => root?.render(<TooltipProvider><AppShell agentClient={new MockAgentClient()}
        filePanel={null} mainContent={<div>内容</div>} projectNavigator={<div>对话树</div>} /></TooltipProvider>));
      const edge = container.querySelector("[data-navigator-hover-edge]")!;
      act(() => { edge.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); vi.advanceTimersByTime(180); });
      const panel = container.querySelector("[data-navigator-peek]")!;
      expect(panel).not.toBeNull();
      expect(useWorkbenchUiStore.getState().isProjectNavigatorOpen).toBe(false);
      act(() => { panel.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); vi.advanceTimersByTime(150); });
      act(() => { panel.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); vi.advanceTimersByTime(300); });
      expect(container.querySelector("[data-navigator-peek]")).not.toBeNull();
      act(() => { panel.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); vi.advanceTimersByTime(280); });
      expect(container.querySelector(".workbench-sidebar--left")).toBeNull();
      act(() => useWorkbenchUiStore.getState().setProjectNavigatorOpen(true));
      const pinned = container.querySelector(".workbench-sidebar--left")!;
      act(() => { pinned.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); vi.advanceTimersByTime(500); });
      expect(container.querySelector(".workbench-sidebar--left")).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("supports fixed-width scrolling and all titlebar tab close actions", async () => {
    const onCloseAll = vi.fn();
    const onClose = vi.fn();
    const onCloseOthers = vi.fn();
    const onSelect = vi.fn();
    const onMove = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          activeConversationId="running"
          agentClient={new MockAgentClient()}
          conversationTabs={[
            {
              icon: <span data-testid="conversation-specific-icon">A</span>,
              id: "idle",
              isRunning: false,
              title: "需求整理",
            },
            { id: "running", isRunning: true, title: "实现顶部标签" },
            { id: "generic", isRunning: false, title: "普通对话" },
          ]}
          filePanel={<div>右侧工作区</div>}
          mainContent={<div>主工作区</div>}
          projectNavigator={<div>项目导航</div>}
          onCloseAllConversationTabs={onCloseAll}
          onCloseConversationTab={onClose}
          onCloseOtherConversationTabs={onCloseOthers}
          onSelectConversationTab={onSelect}
          onMoveConversationTab={onMove}
        />
      </TooltipProvider>,
    ));
    await act(async () => Promise.resolve());

    const dragTabs = container.querySelectorAll<HTMLElement>(".reorderable-tab");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    function drag(type: string, index: number | HTMLElement) {
      const event = new MouseEvent(type, { bubbles: true, clientX: 10 });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      act(() => { (typeof index === "number" ? dragTabs[index] : index)?.dispatchEvent(event); });
    }
    drag("dragstart", 0);
    drag("dragover", 2);
    expect(dragTabs[2]?.dataset.tabDrop).toBe("after");
    drag("drop", 2);
    expect(onMove).toHaveBeenCalledWith("idle", "generic", "after");
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector("[data-tab-drop]")).toBeNull();
    const tabSurface = container.querySelector<HTMLElement>(".app-titlebar__conversation-surface")!;
    drag("dragstart", 0);
    drag("dragover", tabSurface);
    expect(dragTabs[2]?.dataset.tabDrop).toBe("after");
    drag("drop", tabSurface);
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMove).toHaveBeenLastCalledWith("idle", "generic", "after");
    expect(tabSurface.dataset.tabReordering).toBeUndefined();
    const dragTitlebar = container.querySelector<HTMLElement>(".app-titlebar")!;
    drag("dragstart", 0);
    expect(dragTitlebar.dataset.tabReordering).toBe("true");
    drag("dragover", dragTitlebar);
    drag("drop", dragTitlebar);
    expect(onMove).toHaveBeenCalledTimes(3);
    expect(onMove).toHaveBeenLastCalledWith("idle", "generic", "after");
    expect(dragTitlebar.dataset.tabReordering).toBeUndefined();

    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent)
      .toContain("实现顶部标签");
    expect(container.querySelector('[data-testid="conversation-specific-icon"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="实现顶部标签 正在工作"]')).not.toBeNull();
    expect(container.querySelector(".lucide-message-square-text")).not.toBeNull();
    const titlebar = container.querySelector<HTMLElement>(".app-titlebar");
    const leadingDragRegion = container.querySelector<HTMLElement>(
      ".app-titlebar__conversation-leading",
    );
    const trailingDragRegion = container.querySelector<HTMLElement>(
      ".app-titlebar__conversation-surface",
    );
    expect(titlebar?.dataset.appDragRegion).toBe("true");
    expect(leadingDragRegion?.dataset.appDragRegion).toBe("true");
    expect(trailingDragRegion?.dataset.appDragRegion).toBe("true");
    expect(container.querySelector(".activity-bar")).toBeNull();
    expect(leadingDragRegion?.style.getPropertyValue(
      "--app-titlebar-conversation-leading-width",
    )).toBe("124px");

    const idleTab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    const openIdleTabMenu = (): void => {
      idleTab?.parentElement?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 200,
        clientY: 24,
      }));
    };
    const clickMenuItem = (label: string): void => {
      const item = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((candidate) => candidate.textContent?.includes(label));
      item?.click();
    };

    act(openIdleTabMenu);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("关闭标签");
    act(() => clickMenuItem("关闭标签"));
    expect(onClose).toHaveBeenCalledWith("idle");

    act(openIdleTabMenu);
    act(() => clickMenuItem("关闭其他标签"));
    expect(onCloseOthers).toHaveBeenCalledWith("idle");

    act(openIdleTabMenu);
    act(() => clickMenuItem("关闭全部标签"));
    expect(onCloseAll).toHaveBeenCalledOnce();

    act(() => idleTab?.click());
    expect(onSelect).toHaveBeenCalledWith("idle");
    act(() => container.querySelector<HTMLButtonElement>(
      '[aria-label="关闭对话标签：实现顶部标签"]',
    )?.click());
    expect(onClose).toHaveBeenCalledWith("running");

    act(() => useWorkbenchUiStore.getState().setProjectNavigatorOpen(false));
    expect(leadingDragRegion?.style.getPropertyValue(
      "--app-titlebar-conversation-leading-width",
    )).toBe("0px");

    const tabList = container.querySelector<HTMLElement>(
      ".app-titlebar__conversation-tabs",
    );
    if (tabList === null) throw new Error("expected conversation tab list");
    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 220 },
      scrollWidth: { configurable: true, value: 440 },
    });
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    act(() => {
      tabList.dispatchEvent(wheelEvent);
    });
    expect(tabList.scrollLeft).toBe(220);

    tabList.scrollLeft = 70;
    const reverseWheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
    });
    act(() => {
      tabList.dispatchEvent(reverseWheelEvent);
    });
    expect(tabList.scrollLeft).toBe(0);

    Object.defineProperties(tabList, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 660 },
    });
    tabList.scrollLeft = 220;
    act(() => {
      tabList.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
      }));
    });
    expect(tabList.scrollLeft).toBe(360);
  });

  it("applies the active theme to document-level portals", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          agentClient={new MockAgentClient()}
          filePanel={<div>右侧工作区</div>}
          mainContent={<div>主工作区</div>}
          projectNavigator={<div>项目导航</div>}
        />
      </TooltipProvider>,
    ));

    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => useWorkbenchUiStore.getState().setThemeMode("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps the right workspace mounted while it is collapsed", () => {
    let mountCount = 0;
    function StatefulFilePanel(): ReactElement {
      const [activeTab, setActiveTab] = useState("侧边聊天");
      useEffect(() => {
        mountCount += 1;
      }, []);
      return (
        <button type="button" onClick={() => setActiveTab("README.md")}>
          {activeTab}
        </button>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          agentClient={new MockAgentClient()}
          filePanel={<StatefulFilePanel />}
          mainContent={<div>主工作区</div>}
          projectNavigator={<div>项目导航</div>}
        />
      </TooltipProvider>,
    ));

    const filePanelButton = (): HTMLButtonElement | null =>
      container.querySelector(".workbench-sidebar--right button");
    act(() => filePanelButton()?.click());
    expect(filePanelButton()?.textContent).toBe("README.md");

    act(() => useWorkbenchUiStore.getState().setFilePanelOpen(false));
    expect(filePanelButton()?.textContent).toBe("README.md");

    act(() => useWorkbenchUiStore.getState().setFilePanelOpen(true));
    expect(filePanelButton()?.textContent).toBe("README.md");
    expect(mountCount).toBe(1);
  });

  it("removes the left resize hit area when the navigator is collapsed", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell agentClient={new MockAgentClient()} filePanel={<div />} mainContent={<div />}
          projectNavigator={<div>项目导航</div>} />
      </TooltipProvider>,
    ));
    expect(container.querySelector(".workbench-resizable-divider--left")).not.toBeNull();
    act(() => useWorkbenchUiStore.getState().setProjectNavigatorOpen(false));
    expect(container.querySelector(".workbench-resizable-divider--left")).toBeNull();
    expect(container.querySelector('[aria-label="拖动展开项目栏"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="展开对话列表"]')?.click());
    expect(container.querySelector(".workbench-resizable-divider--left")).not.toBeNull();
  });

  it.each(["pointerup", "pointercancel"])("preserves drag-to-collapse and drag-back until %s", (endEvent) => {
    const min = PROJECT_NAVIGATOR_WIDTH_RANGE.min;
    useWorkbenchUiStore.setState({ projectNavigatorWidth: min });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell agentClient={new MockAgentClient()} filePanel={<div />} mainContent={<div />}
          projectNavigator={<div>项目导航</div>} />
      </TooltipProvider>,
    ));
    const divider = container.querySelector<HTMLElement>(".workbench-resizable-divider--left")!;
    divider.setPointerCapture = vi.fn();
    const pointer = (target: EventTarget, type: string, clientX: number): void => {
      act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX })); });
    };
    pointer(divider, "pointerdown", 300);
    pointer(window, "pointermove", 260);
    expect(useWorkbenchUiStore.getState().isProjectNavigatorOpen).toBe(false);
    expect(container.querySelector(".workbench-resizable-divider--left")).toBe(divider);
    pointer(window, "pointermove", 340);
    expect(useWorkbenchUiStore.getState().isProjectNavigatorOpen).toBe(true);
    pointer(window, "pointermove", 380);
    expect(useWorkbenchUiStore.getState().projectNavigatorWidth).toBe(min + 40);
    pointer(window, "pointermove", 300);
    expect(useWorkbenchUiStore.getState().isProjectNavigatorOpen).toBe(false);
    pointer(window, endEvent, 300);
    expect(container.querySelector(".workbench-resizable-divider--left")).toBeNull();
    pointer(window, "pointermove", 500);
    expect(useWorkbenchUiStore.getState().isProjectNavigatorOpen).toBe(false);
    expect(document.body.dataset.resizingPanel).toBeUndefined();
  });

  it("keeps untouched conversations collapsed and restores each conversation's open state", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function renderShell(activeConversationId: string): void {
      root?.render(
        <TooltipProvider>
          <AppShell
            activeConversationId={activeConversationId}
            agentClient={new MockAgentClient()}
            filePanel={<div>右侧工作区</div>}
            mainContent={<div>主工作区</div>}
            projectNavigator={<div>项目导航</div>}
          />
        </TooltipProvider>,
      );
    }

    act(() => renderShell("conversation-a"));
    const rightPanel = (): HTMLElement | null =>
      container.querySelector(".workbench-sidebar--right");
    expect(rightPanel()?.hidden).toBe(true);

    act(() => container.querySelector<HTMLButtonElement>(
      '[aria-label="展开右侧工作区"]',
    )?.click());
    expect(rightPanel()?.hidden).toBe(false);

    act(() => renderShell("conversation-b"));
    expect(rightPanel()?.hidden).toBe(true);

    act(() => renderShell("conversation-a"));
    expect(rightPanel()?.hidden).toBe(false);
  });

  it("shows the global right workspace control on the team page without a placeholder left icon", () => {
    useWorkbenchUiStore.setState({ activeActivity: "team", isFilePanelOpen: true });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          agentClient={new MockAgentClient()}
          filePanel={<div>Agent 完整对话</div>}
          mainContent={<div>团队页面</div>}
          projectNavigator={<div>项目导航</div>}
        />
      </TooltipProvider>,
    ));

    expect(container.querySelector(".app-titlebar__brand-icon")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="收起右侧工作区"]')).not.toBeNull();
    expect(container.querySelector(".workbench-sidebar--right")?.textContent).toContain("Agent 完整对话");

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="收起右侧工作区"]')?.click());
    expect(container.querySelector<HTMLElement>(".workbench-sidebar--right")?.hidden).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="展开右侧工作区"]')).not.toBeNull();
  });

  it("keeps settings workspaces scoped to their settings section without opening conversations", () => {
    useWorkbenchUiStore.setState({
      activeActivity: "settings",
      agentPromptWorkspaceTarget: { agentId: "agent-1", title: "默认 Agent 提示词" },
      isFilePanelOpen: false,
      isSettingsFilePanelOpen: true,
      settingsSection: "agents",
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          activeConversationId="conversation-a"
          agentClient={new MockAgentClient()}
          filePanel={<div>默认 Agent 提示词</div>}
          mainContent={<div>设置页面</div>}
          projectNavigator={<div>项目导航</div>}
        />
      </TooltipProvider>,
    ));

    const rightPanel = (): HTMLElement | null =>
      container.querySelector(".workbench-sidebar--right");
    expect(rightPanel()?.hidden).toBe(false);

    act(() => useWorkbenchUiStore.getState().setSettingsSection("general"));
    expect(rightPanel()?.hidden).toBe(true);

    act(() => useWorkbenchUiStore.getState().setSettingsSection("agents"));
    expect(rightPanel()?.hidden).toBe(false);

    act(() => useWorkbenchUiStore.getState().setActiveActivity("conversations"));
    expect(rightPanel()?.hidden).toBe(true);

    act(() => useWorkbenchUiStore.getState().setFilePanelOpenForConversation(
      "conversation-a",
      true,
    ));
    expect(rightPanel()?.hidden).toBe(false);

    act(() => useWorkbenchUiStore.getState().setActiveActivity("settings"));
    expect(rightPanel()?.hidden).toBe(false);
    act(() => useWorkbenchUiStore.getState().closeAgentPromptWorkspace("agent-1"));
    expect(rightPanel()?.hidden).toBe(true);

    act(() => useWorkbenchUiStore.getState().setActiveActivity("conversations"));
    act(() => useWorkbenchUiStore.getState().setActiveActivity("settings"));
    expect(rightPanel()?.hidden).toBe(true);
  });

  it("restores the right workspace width for each conversation", () => {
    useWorkbenchUiStore.setState({
      filePanelOpenByConversationId: {
        "conversation-a": true,
        "conversation-b": true,
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function renderShell(activeConversationId: string): void {
      root?.render(
        <TooltipProvider>
          <AppShell
            activeConversationId={activeConversationId}
            agentClient={new MockAgentClient()}
            filePanel={<div>右侧工作区</div>}
            mainContent={<div>主工作区</div>}
            projectNavigator={<div>项目导航</div>}
          />
        </TooltipProvider>,
      );
    }

    act(() => renderShell("conversation-a"));
    const rightPanel = (): HTMLElement | null =>
      container.querySelector(".workbench-sidebar--right");
    const resizeDivider = (): HTMLElement | null =>
      container.querySelector('[aria-label="调整右侧工作区宽度"]');

    act(() => {
      resizeDivider()?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowLeft",
      }));
    });
    expect(rightPanel()?.style.width).toBe("536px");

    act(() => renderShell("conversation-b"));
    expect(rightPanel()?.style.width).toBe("520px");
    act(() => {
      resizeDivider()?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "End",
      }));
    });
    expect(rightPanel()?.style.width).toBe("960px");

    act(() => renderShell("conversation-a"));
    expect(rightPanel()?.style.width).toBe("536px");
    act(() => useWorkbenchUiStore.getState().setFilePanelOpen(false));
    act(() => useWorkbenchUiStore.getState().setFilePanelOpen(true));
    expect(rightPanel()?.style.width).toBe("536px");

    act(() => renderShell("conversation-b"));
    expect(rightPanel()?.style.width).toBe("960px");
  });

  it("keeps the navigator and its toggle available on settings pages", async () => {
    useWorkbenchUiStore.getState().setSettings();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TooltipProvider>
        <AppShell
          agentClient={new MockAgentClient()}
          filePanel={<div />}
          mainContent={<div />}
          projectNavigator={<div />}
        />
      </TooltipProvider>,
    ));

    await act(async () => Promise.resolve());
    expect(container.querySelector('.workbench-sidebar--left')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="收起对话列表"]')?.click());
    expect(container.querySelector('.workbench-sidebar--left')).toBeNull();
    expect(container.querySelector('[aria-label="展开对话列表"]')).not.toBeNull();
  });
});
