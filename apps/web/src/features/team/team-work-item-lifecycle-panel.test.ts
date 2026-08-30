import { describe, expect, it } from "vitest";

import { compactDeliverySummary } from "./team-work-item-lifecycle-panel.js";

describe("compactDeliverySummary", () => {
  it("keeps short summaries intact after normalizing whitespace", () => {
    expect(compactDeliverySummary("  已完成\n并通过验证  ")).toBe("已完成 并通过验证");
  });

  it("keeps a long delivery compact until the user expands it", () => {
    expect(compactDeliverySummary("a".repeat(300))).toHaveLength(281);
    expect(compactDeliverySummary("a".repeat(300)).endsWith("…")).toBe(true);
  });
});
