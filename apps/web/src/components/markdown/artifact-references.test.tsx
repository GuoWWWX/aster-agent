// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentMarkdown, renderAgentMarkdown } from "./agent-markdown.js";
import { MarkdownArtifactScope, standaloneArtifactReferences } from "./artifact-references.js";

const ref = "artifact:00000000-0000-4000-8000-000000000001";
const link = `[作品](${ref})`;
const render = (content: string, streaming = false) => {
  const node = document.createElement("div");
  node.innerHTML = renderAgentMarkdown(content, false, false, "[]", JSON.stringify([ref]), streaming);
  return node;
};

describe("paragraph artifact references", () => {
  it("places an existing code fence in a standalone final paragraph without duplicating its source text", () => {
    const codeRef = "codeblock:00000000-0000-4000-8000-000000000001:1";
    const content = `完成。\n\n[React 作品](${codeRef})\n\n已检查。`;
    const markup = renderAgentMarkdown(content, false, false, "[]", JSON.stringify([codeRef]));
    expect(markup).toContain(`data-artifact-reference="${codeRef}"`);
    expect([...standaloneArtifactReferences(content)]).toEqual([codeRef]);
    const inline = renderAgentMarkdown(`查看 [作品](${codeRef}) 即可。`, false, false, "[]", JSON.stringify([codeRef]));
    expect(inline).not.toContain("data-artifact-reference");
    expect(inline).not.toContain('href="codeblock:');
  });
  it("places one delivery between complete paragraphs, including reference-style Markdown links", () => {
    for (const content of [`说明。\n\n${link}\n\n验证通过。`, `说明。\n\n[作品][result]\n\n验证通过。\n\n[result]: ${ref}`]) {
      const node = render(content);
      expect([...node.children].map(child => child.tagName)).toEqual(["P", "DIV", "P"]);
      expect(node.children[1]?.getAttribute("data-artifact-reference")).toBe(ref);
      expect([...standaloneArtifactReferences(content)]).toEqual([ref]);
    }
  });

  it("does not expand a sentence, fenced example, quote, list, image syntax or incomplete link", () => {
    for (const content of [`查看${link}再继续。`, `${link}\n还没说完。`, `> ${link}`, `- ${link}`, `\`\`\`markdown\n${link}\n\`\`\``, `!${link}`, `[作品](${ref}`]) {
      expect(render(content).querySelector("[data-artifact-reference]")).toBeNull();
      expect(standaloneArtifactReferences(content).size).toBe(0);
    }
  });

  it("waits for a paragraph boundary while streaming and resolves once at completion", () => {
    expect(render(link, true).querySelector("[data-artifact-reference]")).toBeNull();
    expect(standaloneArtifactReferences(`${link}\n`, true).size).toBe(0);
    expect(render(`${link}\n\n`, true).querySelector("[data-artifact-reference]")).not.toBeNull();
    expect(standaloneArtifactReferences(`${link}\n\n`, true).has(ref)).toBe(true);
    expect(render(link).querySelector("[data-artifact-reference]")).not.toBeNull();
    expect(render(`${link}\n\n${link}`).querySelectorAll("[data-artifact-reference]")).toHaveLength(1);
  });

  it("keeps unknown references inert without mounting arbitrary paths or external URLs", () => {
    const node = document.createElement("div");
    node.innerHTML = renderAgentMarkdown(link);
    expect(node.textContent).toBe("作品\n");
    expect(node.querySelector("a")).toBeNull();
    for (const target of ["artifact:../secret.html", "artifact:https://example.com", "artifact:invalid"]) {
      expect(render(`[内容](${target})`).querySelector("[data-artifact-reference]")).toBeNull();
    }
  });

  it("mounts the existing React delivery inside the Markdown block and keeps it after rerender", () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const artifacts = new Map([[ref, <button type="button">可交互作品</button>]]);
    const content = `说明。\n\n${link}\n\n验证通过。`;
    act(() => { root.render(<MarkdownArtifactScope artifacts={artifacts}><AgentMarkdown content={content} /></MarkdownArtifactScope>); });
    expect([...host.querySelector(".agent-markdown")!.children].map(child => child.textContent)).toEqual(["说明。", "可交互作品", "验证通过。"]);
    const originalButton = host.querySelector("button");
    const moreArtifacts = new Map([...artifacts, ["artifact:00000000-0000-4000-8000-000000000002", <div>其他交付</div>]]);
    act(() => { root.render(<MarkdownArtifactScope artifacts={moreArtifacts}><AgentMarkdown content={content} /></MarkdownArtifactScope>); });
    expect(host.querySelector("button")).toBe(originalButton);
    act(() => { root.render(<MarkdownArtifactScope artifacts={artifacts}><AgentMarkdown content={`${content}\n\n已交付。`} /></MarkdownArtifactScope>); });
    expect(host.querySelectorAll("button")).toHaveLength(1);
    act(() => root.unmount()); host.remove();
  });
});
