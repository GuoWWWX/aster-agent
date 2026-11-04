import { describe, expect, it } from "vitest";
import { parseCodexUpdatePatch } from "./codex-update-patch.js";

const patch = (body: string) => `*** Begin Patch\n*** Update File: src/a.ts\n${body}\n*** End Patch`;

describe("Codex single-file updates", () => {
  it("applies ordered hunks and preserves CRLF", () => {
    const update = parseCodexUpdatePatch(patch("@@\n-a\n+A\n@@\n c\n-d\n+D"));
    expect(update?.apply("a\r\nb\r\nc\r\nd\r\n")).toBe("A\r\nb\r\nc\r\nD\r\n");
  });
  it("preserves a missing trailing newline", () => {
    expect(parseCodexUpdatePatch(patch("@@\n-a\n+b"))?.apply("a")).toBe("b");
  });
  it("rejects ambiguous or stale context without a partial edit", () => {
    const update = parseCodexUpdatePatch(patch("@@\n-a\n+b"));
    expect(() => update?.apply("a\na\n")).toThrow("不唯一");
    expect(() => update?.apply("c\n")).toThrow("不匹配");
  });
  it("uses an explicit end-of-file constraint", () => {
    expect(parseCodexUpdatePatch(patch("@@\n-a\n+b\n*** End of File"))?.apply("a\na\n"))
      .toBe("a\nb\n");
  });
  it.each(["*** Update File: b.ts", "*** Add File: b.ts", "*** Delete File: b.ts", "*** Move to: b.ts"])("rejects a second operation: %s", (directive) => {
      expect(() => parseCodexUpdatePatch(patch(`@@\n-a\n+b\n${directive}`))).toThrow();
    });
  it.each(["+b", "@@\n+b", "@@\ninvalid", "@@\n-a\n+b\n*** End of File\n+c"])("rejects malformed or context-free edits: %s", (body) => {
      expect(() => parseCodexUpdatePatch(patch(body))).toThrow();
    });
});
