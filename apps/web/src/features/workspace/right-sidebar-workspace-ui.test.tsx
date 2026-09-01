// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightSidebarEmptyState } from "./right-sidebar-workspace.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("RightSidebarEmptyState", () => {
  it("does not pass the React click event to the browser opener", () => {
    const onOpenBrowser = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <RightSidebarEmptyState
        canOpenBrowser
        canOpenGitReview
        canOpenTerminal
        canCreateSideChat
        isCreatingChat={false}
        onCreateSideChat={vi.fn()}
        onOpenBrowser={onOpenBrowser}
        onOpenFiles={vi.fn()}
        onOpenGitReview={vi.fn()}
        onOpenTerminal={vi.fn()}
      />,
    ));

    const browserButton = container.querySelector<HTMLButtonElement>("button[aria-label='浏览器']");
    act(() => browserButton?.click());

    expect(onOpenBrowser).toHaveBeenCalledOnce();
    expect(onOpenBrowser).toHaveBeenCalledWith();
  });
});
