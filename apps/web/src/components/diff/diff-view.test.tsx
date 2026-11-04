import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createDiffPresentation, DiffView } from "./diff-view.js";

describe("createDiffPresentation", () => {
  it("removes patch metadata and presents additions and deletions as source rows", () => {
    const presentation = createDiffPresentation([
      "diff --git a/src/app.ts b/src/app.ts",
      "new file mode 100644",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -2,2 +2,2 @@ function app() {",
      "-  return 'old';",
      "+  return 'new';",
      " }",
    ].join("\n"));

    expect(presentation).toEqual({
      additions: 1,
      deletions: 1,
      lines: [
        { content: "  return 'old';", kind: "deletion", lineNumber: 2 },
        { content: "  return 'new';", kind: "addition", lineNumber: 2 },
        { content: "}", kind: "context", lineNumber: 3 },
      ],
      path: "src/app.ts",
    });
  });

  it("keeps project syntax highlighting inside addition and deletion bands", () => {
    const presentation = createDiffPresentation([
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-const oldValue = 1;",
      "+const newValue = 2;",
    ].join("\n"));

    const html = renderToStaticMarkup(<DiffView presentation={presentation} />);

    expect(html).toContain('data-kind="deletion"');
    expect(html).toContain('data-kind="addition"');
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('class="hljs-number"');
  });

  it("marks the unchanged gap between distant hunks and exposes a context expansion action", () => {
    const presentation = createDiffPresentation([
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -2,2 +2,2 @@",
      "-const first = 1;",
      "+const first = 2;",
      "@@ -80,2 +80,2 @@",
      "-const last = 1;",
      "+const last = 2;",
    ].join("\n"));

    expect(presentation.lines).toContainEqual({
      content: "",
      kind: "collapsed",
      lineNumber: null,
      omittedLines: 77,
    });

    const html = renderToStaticMarkup(<DiffView presentation={presentation} onExpandContext={() => undefined} />);
    expect(html).toContain('data-kind="collapsed"');
    expect(html).toContain("展开查看更多上下文");
  });

  it("escapes source text when the file type has no syntax grammar", () => {
    const html = renderToStaticMarkup(<DiffView presentation={{
      additions: 1,
      deletions: 0,
      lines: [{ content: "<script>alert('x')</script>", kind: "addition", lineNumber: 1 }],
      path: "payload.unknown",
    }} />);

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
