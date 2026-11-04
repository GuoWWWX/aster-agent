import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectTreeNode } from "./project-tree-node.js";

function renderExpandedEmptyDirectory(query: string): string {
  return renderToStaticMarkup(
    <ul>
      <ProjectTreeNode
        customOrders={{}}
        depth={0}
        directories={{
          info: {
            entries: [],
            errorMessage: null,
            isLoading: false,
            truncated: false,
          },
        }}
        draggingPath={null}
        dropIndicator={null}
        entry={{ kind: "directory", name: "info", path: "info" }}
        expandedDirectories={new Set(["info"])}
        locatedPath={null}
        parentPath=""
        query={query}
        selectedPath={null}
        sortOption="name-ascending"
        onDragEnd={() => undefined}
        onDragOver={() => undefined}
        onDragStart={() => undefined}
        onDrop={() => undefined}
        onOpenFile={() => undefined}
        onReload={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
      />
    </ul>,
  );
}

describe("ProjectTreeNode", () => {
  it("leaves an expanded empty directory visually empty", () => {
    const markup = renderExpandedEmptyDirectory("");

    expect(markup).toContain("info");
    expect(markup).not.toContain("空目录");
  });

  it("keeps the no-match message while filtering", () => {
    expect(renderExpandedEmptyDirectory("missing")).toContain("没有匹配项");
  });
});
