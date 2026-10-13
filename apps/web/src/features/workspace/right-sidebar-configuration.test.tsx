// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DocumentCodeEditor } from "../../components/editor/document-code-editor.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { useProjectTree } from "../projects/use-project-tree.js";
import { RightSidebarWorkspace } from "./right-sidebar-workspace.js";

vi.mock("../../components/editor/document-code-editor.js", () => ({
  DocumentCodeEditor: ({ ariaLabel, onChange, value }: ComponentProps<typeof DocumentCodeEditor>) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useWorkbenchUiStore.setState({
    activeActivity: "settings", settingsSection: "skills",
    configurationWorkspaceTarget: null, isSettingsFilePanelOpen: false,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderSidebar(client: MockAgentClient): Promise<HTMLDivElement> {
  function Harness() {
    const tree = useProjectTree(client);
    return <TooltipProvider><RightSidebarWorkspace
      activeProject={null} activeSession={null} agentClient={client}
      fileOpenRequest={null} teamMemberOpenRequest={null} tree={tree}
      onLocateProject={() => {}} onLocateSession={() => {}}
      onSessionViewed={() => {}} onSessionUpdated={() => {}}
    /></TooltipProvider>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  return container;
}

async function openSkill(id: string): Promise<void> {
  await act(async () => {
    useWorkbenchUiStore.getState().openConfigurationWorkspace({ configurationId: id, kind: "skill", title: id });
    await Promise.resolve();
  });
}

function editDocument(container: HTMLElement, content: string): void {
  const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="SKILL.md 文件编辑器"]');
  expect(editor).not.toBeNull();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, content);
  editor!.dispatchEvent(new Event("input", { bubbles: true }));
}

it("saves a Skill draft when another settings entry is opened before autosave fires", async () => {
  const client = new MockAgentClient();
  await client.createSkillDocument();
  await client.createSkillDocument();
  const [first, second] = (await client.getIntegrationConfiguration()).skills;
  const container = await renderSidebar(client);
  await openSkill(first!.id);
  const content = `---\nname: new-skill\ndescription: "快速切换验证"\n---\n\n保留编辑。`;
  act(() => editDocument(container, content));
  await openSkill(second!.id);
  const saved = await client.readConfigurationWorkspaceFile({ configurationId: first!.id, kind: "skill", path: "SKILL.md" });
  expect(saved.content).toBe(content);
  await openSkill(first!.id);
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(content);
});

it("keeps a failed Skill draft when the same entry is opened again", async () => {
  const client = new MockAgentClient();
  await client.createSkillDocument();
  const first = (await client.getIntegrationConfiguration()).skills[0]!;
  const container = await renderSidebar(client);
  await openSkill(first.id);
  const content = `---\nname: new-skill\ndescription: "失败后保留草稿"\n---\n\n保留编辑。`;
  const save = vi.spyOn(client, "writeConfigurationWorkspaceFile").mockRejectedValue(new Error("保存失败"));
  act(() => editDocument(container, content));
  await openSkill(first.id);
  expect(container.textContent).toContain("保存失败");
  save.mockRestore();
  await openSkill(first.id);
  const saved = await client.readConfigurationWorkspaceFile({ configurationId: first.id, kind: "skill", path: "SKILL.md" });
  expect(saved.content).toBe(content);
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(content);
});
