// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TeamWorkspace } from "./team-workspace.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("TeamWorkspace", () => {
  it("keeps execution planning at the right side of the team tabs", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <TeamWorkspace
        agentClient={new MockAgentClient()}
        projects={[{
          id: "00000000-0000-4000-8000-000000000001",
          name: "Mock Project",
          rootPath: "C:/mock-project",
        }]}
      />,
    ));

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.team-view-switcher [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "需求看板",
      "任务与验收",
      "执行规划",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => tabs[2]?.click());
    expect(container.querySelector("#workflow-canvas-heading")?.textContent).toBe("执行规划画布");
  });
});
