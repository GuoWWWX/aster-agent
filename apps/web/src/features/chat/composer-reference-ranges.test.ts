import { describe, expect, it } from "vitest";
import { findComposerReferenceRanges, referenceDeletionRange } from "./composer-reference-ranges.js";

describe("inline composer references", () => {
  it("matches full names with spaces, longest first, without mistaking partial names or email for references", () => {
    const value = "先看 @你好你是 (1) 和 @你好，再用 /review 普通文字 user@你好";
    const ranges = findComposerReferenceRanges(value, ["@你好", "@你好你是 (1)", "/review"]);
    expect(ranges.map((range) => value.slice(range.start, range.end))).toEqual(["@你好你是 (1)", "@你好", "/review"]);
    expect(findComposerReferenceRanges("@你好啊", ["@你好"])).toEqual([]);
  });
  it("keeps repeated references separately so deleting one does not remove the remaining reference", () => {
    expect(findComposerReferenceRanges("@file @file", ["@file"])).toEqual([{ start: 0, end: 5 }, { start: 6, end: 11 }]);
  });
  it("deletes the whole reference from either edge or an interior selection", () => {
    const ranges = [{ start: 3, end: 10 }, { start: 15, end: 20 }];
    expect(referenceDeletionRange(ranges, 10, 10, true)).toEqual({ start: 3, end: 10 });
    expect(referenceDeletionRange(ranges, 3, 3, false)).toEqual({ start: 3, end: 10 });
    expect(referenceDeletionRange(ranges, 6, 7, true)).toEqual({ start: 3, end: 10 });
    expect(referenceDeletionRange(ranges, 8, 17, true)).toEqual({ start: 3, end: 20 });
    expect(referenceDeletionRange(ranges, 3, 3, true)).toBeNull();
    expect(referenceDeletionRange(ranges, 10, 10, false)).toBeNull();
  });
});
