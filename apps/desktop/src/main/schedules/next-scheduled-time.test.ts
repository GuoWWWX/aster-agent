import { describe, expect, it } from "vitest";
import { nextScheduledTime } from "./next-scheduled-time.js";

describe("next scheduled time", () => {
  it("selects a future instant and never replays expired one-off tasks", () => {
    expect(nextScheduledTime({ kind: "once", at: "2026-10-15T00:00:00.000Z" }, new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-15T00:00:00.000Z");
    expect(nextScheduledTime({ kind: "once", at: "2026-10-14T00:00:00.000Z" }, new Date("2026-10-14T00:00:00Z"))).toBeNull();
  });
  it("uses the saved timezone and advances strictly past the trigger", () => {
    expect(nextScheduledTime({ kind: "daily", time: "09:00", timezone: "Asia/Tokyo" }, new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-15T00:00:00.000Z");
  });
  it("respects weekdays across month and year boundaries", () => {
    expect(nextScheduledTime({ kind: "weekly", time: "09:00", timezone: "UTC", weekdays: [1] }, new Date("2026-12-31T10:00:00Z"))).toBe("2027-01-04T09:00:00.000Z");
  });
  it("skips a nonexistent spring DST time and chooses the first autumn occurrence", () => {
    expect(nextScheduledTime({ kind: "daily", time: "02:30", timezone: "America/New_York" }, new Date("2026-03-08T00:00:00Z"))).toBe("2026-03-09T06:30:00.000Z");
    expect(nextScheduledTime({ kind: "daily", time: "01:30", timezone: "America/New_York" }, new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01T05:30:00.000Z");
    expect(nextScheduledTime({ kind: "daily", time: "01:30", timezone: "America/New_York" }, new Date("2026-11-01T05:31:00Z"))).toBe("2026-11-02T06:30:00.000Z");
  });
});
