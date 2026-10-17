import { describe, expect, it, vi } from "vitest";

import type { ConversationRunEvent, DesktopBridge } from "@agent/protocol";

import { DesktopAgentClientAdapter } from "./desktop-agent-client.js";

describe("DesktopAgentClientAdapter", () => {
  it("subscribes only to requested conversation streams and releases them with the view", async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const client = new DesktopAgentClientAdapter({
      onConversationRunEvent: () => () => {}, setConversationStreamSubscriptions: subscribe,
    } as unknown as DesktopBridge);
    const first = client.onConversationRunEvent(() => {}, ["first"]);
    const second = client.onConversationRunEvent(() => {}, ["second"]);
    await Promise.resolve();
    expect(subscribe).toHaveBeenLastCalledWith(["first", "second"]);
    first();
    await Promise.resolve();
    expect(subscribe).toHaveBeenLastCalledWith(["second"]);
    second();
    await Promise.resolve();
    expect(subscribe).toHaveBeenLastCalledWith([]);
  });

  it("shares one bridge event subscription across conversation listeners", () => {
    let bridgeListener: ((event: ConversationRunEvent) => void) | undefined;
    const disposeBridgeListener = vi.fn();
    const onConversationRunEvent = vi.fn((listener: (event: ConversationRunEvent) => void) => {
      bridgeListener = listener;
      return disposeBridgeListener;
    });
    const client = new DesktopAgentClientAdapter({
      onConversationRunEvent,
      setConversationStreamSubscriptions: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopBridge);
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const disposeFirst = client.onConversationRunEvent(firstListener);
    const disposeSecond = client.onConversationRunEvent(secondListener);
    const event = { type: "conversation.updated" } as ConversationRunEvent;
    bridgeListener?.(event);

    expect(onConversationRunEvent).toHaveBeenCalledTimes(1);
    expect(firstListener).toHaveBeenCalledWith(event);
    expect(secondListener).toHaveBeenCalledWith(event);

    disposeFirst();
    expect(disposeBridgeListener).not.toHaveBeenCalled();
    disposeSecond();
    expect(disposeBridgeListener).toHaveBeenCalledTimes(1);
  });
});
