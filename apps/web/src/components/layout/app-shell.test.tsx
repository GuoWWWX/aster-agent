// @vitest-environment jsdom

import { act, useEffect, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { AppShell } from "./app-shell.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useWorkbenchUiStore.setState({
    activeActivity: "conversations",
    filePanelWidth: 520,
    filePanelWidthsByConversationId: {},
    isFilePanelOpen: true,
    isProjectNavigatorOpen: true,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("AppShell", () => {
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
      <AppShell
        agentClient={new MockAgentClient()}
        filePanel={<StatefulFilePanel />}
        mainContent={<div>主工作区</div>}
        projectNavigator={<div>项目导航</div>}
      />,
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

  it("restores the right workspace width for each conversation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function renderShell(activeConversationId: string): void {
      root?.render(
        <AppShell
          activeConversationId={activeConversationId}
          agentClient={new MockAgentClient()}
          filePanel={<div>右侧工作区</div>}
          mainContent={<div>主工作区</div>}
          projectNavigator={<div>项目导航</div>}
        />,
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
});
