import { createContext, useContext, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import { artifactDisplayRefSchema } from "@agent/protocol";

const noArtifacts: ReadonlyMap<string, ReactNode> = new Map();
const ArtifactContext = createContext(noArtifacts);
const referenceParser = new MarkdownIt({ html: false });
type MarkdownRenderer = InstanceType<typeof MarkdownIt>;
type Token = ReturnType<MarkdownRenderer["parse"]>[number];

export function MarkdownArtifactScope({ artifacts, children }: { artifacts: ReadonlyMap<string, ReactNode> | undefined; children: ReactNode }) {
  return <ArtifactContext.Provider value={artifacts ?? noArtifacts}>{children}</ArtifactContext.Provider>;
}

export function useMarkdownArtifacts(): ReadonlyMap<string, ReactNode> { return useContext(ArtifactContext); }

function paragraphReference(tokens: Token[], index: number): string | null {
  const opening = tokens[index], inline = tokens[index + 1], closing = tokens[index + 2];
  if (opening?.type !== "paragraph_open" || opening.level !== 0 || inline?.type !== "inline" || closing?.type !== "paragraph_close") return null;
  const children = inline.children;
  if (children?.length !== 3 || children[0]?.type !== "link_open" || children[1]?.type !== "text" || children[2]?.type !== "link_close") return null;
  const ref = artifactDisplayRefSchema.safeParse(children[0].attrGet("href"));
  return ref.success ? ref.data : null;
}

/** Use Markdown tokens, so fenced examples, quotes, lists and unfinished sentences stay text. */
export function standaloneArtifactReferences(content: string, streaming = false): ReadonlySet<string> {
  if (!content.includes("artifact:")) return new Set();
  const tokens = referenceParser.parse(content, {});
  const lines = content.split("\n");
  return new Set(tokens.flatMap((_token, index) => {
    const ref = paragraphReference(tokens, index);
    const end = tokens[index]?.map?.[1];
    return ref === null || (streaming && (end === undefined || end >= lines.length - 1)) ? [] : [ref];
  }));
}

export function markdownArtifactPlugin(markdown: MarkdownRenderer): void {
  markdown.core.ruler.after("inline", "artifact_references", state => {
    const env: unknown = state.env;
    if (typeof env !== "object" || env === null || !("artifactRefs" in env) || !Array.isArray(env.artifactRefs)) return;
    const available = new Set(env.artifactRefs), rendered = new Set<string>();
    const complete = "streaming" in env && env.streaming === true && "markdown" in env && typeof env.markdown === "string"
      ? standaloneArtifactReferences(env.markdown, true) : null;
    for (let index = 0; index < state.tokens.length; index += 1) {
      const ref = paragraphReference(state.tokens, index);
      if (ref === null || !available.has(ref) || rendered.has(ref) || (complete !== null && !complete.has(ref))) continue;
      rendered.add(ref);
      const slot = new state.Token("artifact_reference", "div", 0);
      slot.content = ref;
      slot.block = true;
      state.tokens.splice(index, 3, slot);
    }
  });
  markdown.renderer.rules.artifact_reference = (tokens, index) => `<div data-artifact-reference="${markdown.utils.escapeHtml(tokens[index]?.content ?? "")}"></div>\n`;
}
