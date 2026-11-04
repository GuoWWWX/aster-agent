import { describe, expect, it } from "vitest";
import { resolveWorkspaceFileLink } from "./workspace-file-link.js";

describe("workspace file links", () => {
  it("resolves Markdown relative paths through the project path contract", () => {
    expect(resolveWorkspaceFileLink("QuickSortDegenerate.java")).toBe("QuickSortDegenerate.java");
    expect(resolveWorkspaceFileLink("./src/quicksort_degenerate.py#L12")).toBe("src/quicksort_degenerate.py");
    expect(resolveWorkspaceFileLink("src/../quicksort-degenerate.js")).toBe("quicksort-degenerate.js");
    expect(resolveWorkspaceFileLink("%E4%BB%A3%E7%A0%81.java")).toBe("代码.java");
  });
  it("does not turn absolute paths or file URLs into workspace paths", () => {
    for (const href of ["D:/Projects/sort/a.java", "file:///D:/Projects/sort/src/test.py", "/home/me/sort/a.js", "\\\\server\\share\\a.py"]) {
      expect(resolveWorkspaceFileLink(href)).toBeNull();
    }
  });
  it("rejects escaping, malformed and external paths", () => {
    for (const href of ["../a.java", "%2e%2e/a.py", "https://example.com/a.js", "//example.com/a.js", "javascript:alert(1)", "sandbox:/mnt/data/a.py", "bad%ZZ.py", "a%00.py", "file://server/share/a.py", "./D:/a.py", "src/../D:/a.py"]) {
      expect(resolveWorkspaceFileLink(href)).toBeNull();
    }
  });
});
