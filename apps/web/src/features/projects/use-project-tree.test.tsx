// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/index.js";
import { useProjectTree, type ProjectTreeController } from "./use-project-tree.js";

it("loads directories only on demand, reuses them until project changes, and permits refresh", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const list = vi.spyOn(client, "listProjectEntries");
  let tree!: ProjectTreeController;
  function FileSurface({ controller, visible }: { controller: ProjectTreeController; visible: boolean }) {
    const ensureRootLoaded = controller.ensureRootLoaded;
    useEffect(() => { if (visible) ensureRootLoaded(); }, [visible, ensureRootLoaded]);
    return null;
  }
  function Harness({ visible }: { visible: boolean }) {
    tree = useProjectTree(client);
    return <FileSurface controller={tree} visible={visible} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (visible: boolean) => { await act(async () => { root.render(<Harness visible={visible} />); await Promise.resolve(); }); };
  try {
    await render(false);
    expect(tree.activeProject).not.toBeNull();
    expect(list).not.toHaveBeenCalled();
    const projectId = tree.activeProject!.id;
    await render(true);
    expect(list).toHaveBeenCalledTimes(1);
    expect(tree.rootDirectoryState?.isLoading).toBe(false);
    await render(false);
    await render(true);
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { tree.refresh(); await Promise.resolve(); });
    expect(list).toHaveBeenCalledTimes(2);
    await render(false);
    act(() => tree.selectProject(null));
    act(() => tree.selectProject(projectId));
    expect(list).toHaveBeenCalledTimes(2);
    await render(true);
    expect(list).toHaveBeenCalledTimes(3);
  } finally { act(() => root.unmount()); container.remove(); }
});
