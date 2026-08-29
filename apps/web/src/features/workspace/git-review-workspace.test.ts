import { describe, expect, it } from "vitest";

import type { GitWorkingTreeChange } from "@agent/protocol";

import {
  allGitChangePathsSelected,
  backgroundDiffPaths,
  clampCommitPanelHeight,
  extendGitChangeSelection,
  toggleGitChangeGroupSelection,
  toggleGitChangeSelection,
} from "./git-review-workspace.js";

function change(
  path: string,
  additions: number | null = 1,
  deletions: number | null = 0,
): GitWorkingTreeChange {
  return {
    additions,
    deletions,
    isStaged: false,
    originalPath: null,
    path,
    status: " M",
  };
}

describe("Git diff background prefetch", () => {
  it("warms textual diffs and skips binary files", () => {
    expect(backgroundDiffPaths([
      change("src/app.ts"),
      change("assets/logo.png", null, null),
      change("src/app.ts"),
      change("src/feature.ts"),
    ])).toEqual(["src/app.ts", "src/feature.ts"]);
  });

  it("keeps the prefetch queue bounded", () => {
    const paths = backgroundDiffPaths(Array.from(
      { length: 24 },
      (_, index) => change(`src/file-${index}.ts`),
    ));

    expect(paths).toHaveLength(20);
    expect(paths.at(-1)).toBe("src/file-19.ts");
  });
});

describe("Git commit card resize", () => {
  it("keeps a usable review pane and commit card while resizing", () => {
    expect(clampCommitPanelHeight(80, 600)).toBe(155);
    expect(clampCommitPanelHeight(900, 600)).toBe(450);
    expect(clampCommitPanelHeight(224.6, 600)).toBe(225);
  });
});

describe("Git change selection", () => {
  it("toggles a file without affecting the other selected files", () => {
    expect([...toggleGitChangeSelection(new Set(["src/a.ts"]), "src/b.ts")]).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect([...toggleGitChangeSelection(new Set(["src/a.ts", "src/b.ts"]), "src/a.ts")]).toEqual([
      "src/b.ts",
    ]);
  });

  it("extends selection to the adjacent visible file with Ctrl and an arrow key", () => {
    expect(extendGitChangeSelection(
      new Set(["src/b.ts"]),
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      "src/b.ts",
      1,
      {
        anchorPath: "src/b.ts",
        focusPath: "src/b.ts",
        initiallySelectedPaths: new Set(),
      },
    )).toEqual({
      keyboardSelection: {
        anchorPath: "src/b.ts",
        focusPath: "src/c.ts",
        initiallySelectedPaths: new Set(),
      },
      nextPath: "src/c.ts",
      selectedPaths: new Set(["src/b.ts", "src/c.ts"]),
    });
  });

  it("retracts toward the anchor before extending to the other side", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"];
    const anchor = {
      anchorPath: "src/b.ts",
      focusPath: "src/d.ts",
      initiallySelectedPaths: new Set(["docs/readme.md"]),
    };
    const retracted = extendGitChangeSelection(
      new Set(["docs/readme.md", "src/b.ts", "src/c.ts", "src/d.ts"]),
      paths,
      "src/d.ts",
      -1,
      anchor,
    );
    expect(retracted.selectedPaths).toEqual(new Set(["docs/readme.md", "src/b.ts", "src/c.ts"]));
    expect(retracted.nextPath).toBe("src/c.ts");

    const backAtAnchor = extendGitChangeSelection(
      retracted.selectedPaths,
      paths,
      "src/c.ts",
      -1,
      retracted.keyboardSelection,
    );
    expect(backAtAnchor.selectedPaths).toEqual(new Set(["docs/readme.md", "src/b.ts"]));
    expect(backAtAnchor.nextPath).toBe("src/b.ts");

    const extendedAboveAnchor = extendGitChangeSelection(
      backAtAnchor.selectedPaths,
      paths,
      "src/b.ts",
      -1,
      backAtAnchor.keyboardSelection,
    );
    expect(extendedAboveAnchor.selectedPaths).toEqual(new Set(["docs/readme.md", "src/a.ts", "src/b.ts"]));
    expect(extendedAboveAnchor.nextPath).toBe("src/a.ts");
  });

  it("never crosses into another change group", () => {
    const selection = extendGitChangeSelection(
      new Set(["staged/a.ts"]),
      ["staged/a.ts"],
      "staged/a.ts",
      1,
      {
        anchorPath: "staged/a.ts",
        focusPath: "staged/a.ts",
        initiallySelectedPaths: new Set(),
      },
    );
    expect(selection.nextPath).toBeNull();
    expect(selection.selectedPaths).toEqual(new Set(["staged/a.ts"]));
  });

  it("selects and clears only the requested change group", () => {
    const groupPaths = ["src/a.ts", "src/b.ts"];
    const selected = toggleGitChangeGroupSelection(new Set(["docs/readme.md"]), groupPaths);
    expect([...selected]).toEqual(["docs/readme.md", "src/a.ts", "src/b.ts"]);
    expect(allGitChangePathsSelected(selected, groupPaths)).toBe(true);

    const cleared = toggleGitChangeGroupSelection(selected, groupPaths);
    expect([...cleared]).toEqual(["docs/readme.md"]);
    expect(allGitChangePathsSelected(cleared, groupPaths)).toBe(false);
  });
});
