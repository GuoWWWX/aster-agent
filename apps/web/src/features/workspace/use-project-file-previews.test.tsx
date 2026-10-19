// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ProjectFile } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import type { ProjectFileTab } from "./sidebar-workspace-types.js";
import { useProjectFilePreviews } from "./use-project-file-previews.js";

const tab: ProjectFileTab = {
  id: "file:project:readme.md", kind: "file", javaDeclarationKind: undefined,
  name: "readme.md", path: "readme.md", projectId: "project",
};

function file(content: string): ProjectFile {
  return { byteLength: content.length, content, isBinary: false, name: tab.name,
    path: tab.path, projectId: tab.projectId, truncated: false };
}

let root: Root | null = null;
beforeEach(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function fixture(client: MockAgentClient) {
  let controller!: ReturnType<typeof useProjectFilePreviews>;
  const reloadDirectory = vi.fn();
  function Harness() {
    controller = useProjectFilePreviews({ agentClient: client, activeProjectId: tab.projectId,
      fileTabs: [tab], reloadProjectDirectory: reloadDirectory });
    return null;
  }
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  return { current: () => controller, reloadDirectory };
}

it("keeps the newest document when an earlier file read finishes late", async () => {
  const client = new MockAgentClient();
  let resolveFirst!: (result: ProjectFile) => void;
  let resolveSecond!: (result: ProjectFile) => void;
  vi.spyOn(client, "readProjectFile")
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  const f = await fixture(client);
  let first!: Promise<void>; let second!: Promise<void>;
  act(() => { first = f.current().loadFile(tab); second = f.current().loadFile(tab); });
  await act(async () => { resolveSecond(file("newest")); await second; });
  await act(async () => { resolveFirst(file("older")); await first; });
  expect(f.current().filePreviews[tab.id]?.draft).toBe("newest");
  expect(f.current().filePreviews[tab.id]?.contentRevision).toBe(1);
});

it("saves the latest Ctrl+S content before React commits the draft update", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "readProjectFile").mockResolvedValue(file("original"));
  const write = vi.spyOn(client, "writeProjectFile").mockImplementation(input => Promise.resolve(file(input.content)));
  const f = await fixture(client);
  await act(async () => f.current().loadFile(tab));
  await act(async () => {
    f.current().updateFileDraft(tab.id, "immediate draft");
    expect(await f.current().flushFileSave(tab, undefined, "immediate draft")).toBe(true);
  });
  expect(write).toHaveBeenCalledExactlyOnceWith({ content: "immediate draft", expectedContent: "original", path: tab.path, projectId: tab.projectId });
  expect(f.current().filePreviews[tab.id]?.isDirty).toBe(false);
  expect(f.reloadDirectory).toHaveBeenCalledWith("");
});

it("retains edits made during a save and uses the saved revision on the next write", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "readProjectFile").mockResolvedValue(file("original"));
  let finishSave!: (result: ProjectFile) => void;
  const write = vi.spyOn(client, "writeProjectFile")
    .mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }))
    .mockImplementation(input => Promise.resolve(file(input.content)));
  const f = await fixture(client);
  await act(async () => f.current().loadFile(tab));
  act(() => f.current().markFileDirty(tab.id, "first edit"));
  let pending!: Promise<boolean>;
  await act(async () => { pending = f.current().flushFileSave(tab); await Promise.resolve(); });
  act(() => f.current().markFileDirty(tab.id, "second edit"));
  await act(async () => { finishSave(file("first edit")); await pending; });
  expect(f.current().filePreviews[tab.id]?.draft).toBe("second edit");
  expect(f.current().filePreviews[tab.id]?.isDirty).toBe(true);
  await act(async () => { expect(await f.current().flushFileSave(tab)).toBe(true); });
  expect(write).toHaveBeenLastCalledWith({ content: "second edit", expectedContent: "first edit", path: tab.path, projectId: tab.projectId });
});

it("preserves a conflicting draft instead of replacing it with a failed save", async () => {
  const client = new MockAgentClient();
  vi.spyOn(client, "readProjectFile").mockResolvedValue(file("original"));
  vi.spyOn(client, "writeProjectFile").mockRejectedValue(Object.assign(new Error("changed elsewhere"), { code: "FILE_CHANGED" }));
  const f = await fixture(client);
  await act(async () => f.current().loadFile(tab));
  act(() => f.current().markFileDirty(tab.id, "unsaved edit"));
  await act(async () => { expect(await f.current().flushFileSave(tab)).toBe(false); });
  expect(f.current().filePreviews[tab.id]).toMatchObject({ conflict: "stale", draft: "unsaved edit", isDirty: true, isSaving: false, savedContent: "original" });
});
