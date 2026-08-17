import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import MarkdownIt from "markdown-it";
import { useMemo, type ReactElement } from "react";

import "./agent-markdown.css";

hljs.registerLanguage("powershell", powershell);
hljs.registerAliases(["ps", "ps1", "pwsh"], { languageName: "powershell" });

const languageAliases: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  html: "xml",
  jsx: "javascript",
  md: "markdown",
  plaintext: "",
  shell: "bash",
  sh: "bash",
  text: "",
  tsx: "typescript",
  txt: "",
  yml: "yaml",
  zsh: "bash",
};

const renderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
});

renderer.core.ruler.after("inline", "agent_task_lists", (state) => {
  state.tokens.forEach((token, tokenIndex) => {
    if (token.type !== "inline" || token.children?.[0]?.type !== "text") {
      return;
    }

    const firstChild = token.children[0];
    const taskMarker = /^\[([ xX])\]\s+/.exec(firstChild.content);
    if (taskMarker === null) {
      return;
    }

    let listItemOpen;
    for (let index = tokenIndex - 1; index >= 0; index -= 1) {
      if (state.tokens[index]?.type === "list_item_close") {
        break;
      }
      if (state.tokens[index]?.type === "list_item_open") {
        listItemOpen = state.tokens[index];
        break;
      }
    }
    if (listItemOpen === undefined) {
      return;
    }

    const checked = taskMarker[1]?.toLowerCase() === "x";
    firstChild.content = firstChild.content.slice(taskMarker[0].length);
    listItemOpen.attrJoin("class", "agent-markdown__task-item");

    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input class="agent-markdown__task-checkbox" type="checkbox" disabled${checked ? " checked" : ""} aria-label="${checked ? "已完成任务" : "未完成任务"}">`;
    token.children.unshift(checkbox);
  });
});

const defaultLinkOpen = renderer.renderer.rules.link_open;
renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  tokens[index]?.attrSet("rel", "noreferrer noopener");
  tokens[index]?.attrSet("target", "_blank");
  return defaultLinkOpen === undefined
    ? self.renderToken(tokens, index, options)
    : defaultLinkOpen(tokens, index, options, environment, self);
};

renderer.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token?.info.trim().split(/\s+/)[0] || "text";
  const source = token?.content ?? "";
  const highlightedSource = highlightCode(source, language);
  return `<pre class="agent-markdown__code-block" data-language="${renderer.utils.escapeHtml(language)}"><code class="hljs">${highlightedSource}</code></pre>\n`;
};

function highlightCode(source: string, language: string): string {
  const normalizedLanguage = languageAliases[language.toLowerCase()] ?? language.toLowerCase();
  if (normalizedLanguage.length === 0 || !hljs.getLanguage(normalizedLanguage)) {
    return renderer.utils.escapeHtml(source);
  }

  try {
    return hljs.highlight(source, { ignoreIllegals: true, language: normalizedLanguage }).value;
  } catch {
    return renderer.utils.escapeHtml(source);
  }
}

export function AgentMarkdown({ content }: { content: string }): ReactElement {
  const html = useMemo(() => renderAgentMarkdown(content), [content]);

  return (
    <div
      className="agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderAgentMarkdown(content: string): string {
  return renderer.render(content);
}
