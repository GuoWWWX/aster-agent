import { ChevronRight, FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle } from "../../components/editor/live-markdown-editor.js";
import { parseAgentPromptDocument, serializeAgentPromptDocument } from "../../lib/agent-prompt-document.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import type { AgentPromptTab } from "./sidebar-workspace-types.js";

export function AgentPromptPreview({
  isDark,
  tab,
}: {
  isDark: boolean;
  tab: AgentPromptTab;
}): ReactElement {
  const agent = useAgentDirectoryStore((state) => (
    state.agents.find((candidate) => candidate.id === tab.agentId)
  ));
  const updateAgent = useAgentDirectoryStore((state) => state.updateAgent);
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null);
  const initialSource = agent === undefined ? "" : serializeAgentPromptDocument(agent);
  const sourceRef = useRef(initialSource);
  const [documentSource, setDocumentSource] = useState(initialSource);
  const [documentRevision, setDocumentRevision] = useState(0);
  const saveDocument = useCallback((source: string): void => {
    if (agent === undefined) return;
    sourceRef.current = source;
    const next = parseAgentPromptDocument(source, agent);
    if (
      next.name === agent.name
      && next.role === agent.role
      && next.description === agent.description
      && next.instructions === agent.instructions
    ) {
      return;
    }
    updateAgent(tab.agentId, next);
  }, [agent, tab.agentId, updateAgent]);

  useEffect(() => {
    if (agent === undefined) return;
    const projected = parseAgentPromptDocument(sourceRef.current, agent);
    if (
      projected.name === agent.name
      && projected.role === agent.role
      && projected.description === agent.description
      && projected.instructions === agent.instructions
    ) {
      return;
    }

    const nextSource = serializeAgentPromptDocument(agent);
    sourceRef.current = nextSource;
    setDocumentSource(nextSource);
    setDocumentRevision((current) => current + 1);
  }, [agent]);

  useEffect(() => {
    editorRef.current?.requestMeasure();
  }, [tab.id]);

  return (
    <section className="right-sidebar-file right-sidebar-config-file" aria-label={tab.title}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="Agent 提示词文档">
          <span className="right-sidebar-config-file__workspace" title={agent?.name ?? tab.title}>
            <FileText aria-hidden="true" size={14} />
            {agent?.name ?? tab.title}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <span className="right-sidebar-config-file__path" title="核心指令.md">
            <FileText aria-hidden="true" size={14} />
            核心指令.md
          </span>
        </div>
      </header>
      {agent === undefined ? (
        <div className="right-sidebar-file__state">该 Agent 已删除，无法继续编辑提示词。</div>
      ) : (
        <LiveMarkdownEditor
          ref={editorRef}
          className="right-sidebar-file__editor"
          contentRevision={documentRevision}
          documentKey={tab.id}
          documentTitle={`${agent.name.trim() || "未命名 Agent"} 的核心指令`}
          initialContent={documentSource}
          isDark={isDark}
          placeholder="用 Markdown 编写这个 Agent 的核心指令…"
          onDirty={saveDocument}
          onDocChanged={saveDocument}
          onRequestSave={saveDocument}
        />
      )}
      <footer className="right-sidebar-config-file__footer">
        <span>Markdown</span>
      </footer>
    </section>
  );
}
