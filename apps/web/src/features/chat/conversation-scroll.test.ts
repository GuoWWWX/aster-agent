import { describe, expect, it } from "vitest";

import { isConversationScrolledToBottom } from "./conversation-scroll.js";

describe("conversation scroll", () => {
  it("keeps following content while the viewport is at the bottom", () => {
    expect(isConversationScrolledToBottom({
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 600,
    })).toBe(true);
    expect(isConversationScrolledToBottom({
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 570,
    })).toBe(true);
  });

  it("stops following after the user scrolls away from the bottom", () => {
    expect(isConversationScrolledToBottom({
      clientHeight: 600,
      scrollHeight: 1_200,
      scrollTop: 500,
    })).toBe(false);
  });
});
