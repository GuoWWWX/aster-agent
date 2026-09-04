// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationSearchResult } from "@agent/protocol";

import { MockAgentClient } from "../../runtime/index.js";
import { GlobalConversationSearchDialog } from "./global-conversation-search-dialog.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  void act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("GlobalConversationSearchDialog", () => {
  it("searches persisted conversations and returns the selected timeline item", async () => {
    const result: ConversationSearchResult = {
      content: "已经完成全局搜索定位。",
      conversationId: "00000000-0000-4000-8000-000000000001",
      conversationTitle: "搜索功能",
      createdAt: "2026-09-04T00:00:00.000Z",
      itemId: "00000000-0000-4000-8000-000000000002",
      parentConversationId: null,
      projectId: null,
      role: "assistant",
      threadKind: "agent",
    };
    const client = new MockAgentClient();
    const search = vi.spyOn(client, "searchConversations").mockResolvedValue([result]);
    const onSelect = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    void act(() => root?.render(
      <GlobalConversationSearchDialog
        agentClient={client}
        open
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    ));
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索所有对话"]');
    if (input === null) throw new Error("Expected global search input.");

    void act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "全局搜索");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 170));
    });
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith({ limit: 50, query: "全局搜索" }));

    const resultButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("已经完成全局搜索定位"));
    expect(resultButton).toBeDefined();
    void act(() => resultButton?.click());
    expect(onSelect).toHaveBeenCalledWith(result);
  });
});
