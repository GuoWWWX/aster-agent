import { expect, it, vi } from "vitest";
import { HtmlPresentationTool, resolveHtmlPresentationSource } from "./html-presentation-tool.js";

const id = "00000000-0000-4000-8000-000000000001";
const ref = `codeblock:${id}:1`;
it("inspects an assistant code fence and returns only its reference, retaining multi-frame controls", async () => {
  const code = "export default () => <button>Count</button>";
  const history = [{ id, kind: "message" as const, role: "assistant", status: "completed", content: `\`\`\`react\n${code}\n\`\`\`` }];
  const inspect = vi.fn().mockResolvedValue({ kind: "completed", isError: false, content: '{"ok":true,"value":{"inspected":true}}' });
  const tool = new HtmlPresentationTool(() => Promise.reject(new Error("No workspace needed")), { inspect },
    (_conversationId, reference) => resolveHtmlPresentationSource(history, reference));
  const result = await tool.execute(id, JSON.stringify({ action: "inspect", sourceRef: "latest", frames: 3, intervalMs: 650, width: 1200, height: 820 }), new AbortController().signal);
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.content)).toMatchObject({ value: { sourceRef: ref, displayRef: ref, language: "react" } });
  expect(result.content).not.toContain(code);
  expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ frames: 3, intervalMs: 650, width: 1200, height: 820,
    source: { kind: "code", html: `${code}\n`, language: "react", conversationId: id } }));
  const parameters = JSON.stringify(tool.getDefinitions()[0]?.parameters);
  expect(parameters).not.toContain('"code":');
  expect(parameters).not.toContain('"language":');
  expect(parameters).toContain("sourceRef");
  expect((await tool.execute(id, JSON.stringify({ action: "inspect", code, language: "react" }), new AbortController().signal)).isError).toBe(true);
});
