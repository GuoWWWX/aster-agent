import { describe, expect, it, vi } from "vitest";

import type { ConversationRunEvent, DesktopBridge } from "@agent/protocol";

import { DesktopAgentClientAdapter } from "./desktop-agent-client.js";

describe("DesktopAgentClientAdapter", () => {
  it("shares one bridge event subscription across conversation listeners", () => {
    let bridgeListener: ((event: ConversationRunEvent) => void) | undefined;
    const disposeBridgeListener = vi.fn();
    const onConversationRunEvent = vi.fn((listener: (event: ConversationRunEvent) => void) => {
      bridgeListener = listener;
      return disposeBridgeListener;
    });
    const client = new DesktopAgentClientAdapter({
      onConversationRunEvent,
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
