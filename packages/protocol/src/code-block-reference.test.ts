import { describe, expect, it } from "vitest";
import { z } from "zod";
import { codeBlockReferenceSchema, previewCodeBlocks, resolveMessageCodeBlock } from "./code-block-reference.js";

const id = "00000000-0000-4000-8000-000000000001";
const message = (content: string) => ({ id, role: "assistant", status: "completed", content });
describe("conversation code block references", () => {
  it("locates complete HTML, React and Vue fences, including JSX/TSX aliases", () => {
    const content = "```html\n<div>one</div>\n```\n\n~~~tsx\nexport default () => <b>two</b>\n~~~\n\n```vue\n<template>three</template>\n```";
    expect(previewCodeBlocks(content)).toEqual([
      { index: 1, code: "<div>one</div>\n", language: "html" },
      { index: 2, code: "export default () => <b>two</b>\n", language: "react" },
      { index: 3, code: "<template>three</template>\n", language: "vue" },
    ]);
    expect(resolveMessageCodeBlock([message(content)], "latest")).toMatchObject({ sourceRef: `codeblock:${id}:3`, language: "vue" });
    const react = resolveMessageCodeBlock([message(content)], `codeblock:${id}:2`);
    expect(react?.language).toBe("react");
    expect(react?.code).toContain("two");
  });
  it("never executes unfinished, nested, unsupported, user or failed message content", () => {
    expect(previewCodeBlocks("````text\n```html\n<b>nested</b>\n```\n````\n```react\nunfinished")).toEqual([]);
    expect(previewCodeBlocks("> ```html\n> <b>quote</b>\n> ```")).toEqual([]);
    expect(previewCodeBlocks("```constructor\nunsupported\n```")).toEqual([]);
    for (const entry of [{ ...message("```html\n<b>x</b>\n```"), role: "user" }, { ...message("```html\n<b>x</b>\n```"), status: "failed" }]) {
      expect(resolveMessageCodeBlock([entry], "latest")).toBeNull();
    }
    expect(resolveMessageCodeBlock([message("```html\n<b>x</b>\n```")], "codeblock:00000000-0000-4000-8000-000000000002:1")).toBeNull();
    for (const ref of [`codeblock:${id}:0`, `codeblock:${id}:01`, `codeblock:${id}:1001`, "codeblock:../secret:1"]) expect(codeBlockReferenceSchema.safeParse(ref).success).toBe(false);
  });
  it("preserves source identity across reloads and selects the last complete block without copying it", () => {
    const entries = [message("```react\nexport default () => <p>one</p>\n```"),
      { ...message("```vue\nunfinished"), id: "00000000-0000-4000-8000-000000000002" }];
    expect(resolveMessageCodeBlock(entries, "latest")).toBeNull();
    const resolved = resolveMessageCodeBlock(entries.slice(0, 1), "latest");
    const reloaded = z.array(z.object({ id: z.string(), role: z.string(), status: z.string(), content: z.string() })).parse(JSON.parse(JSON.stringify(entries)));
    expect(resolveMessageCodeBlock(reloaded, resolved!.sourceRef)).toEqual(resolved);
    expect(resolved?.sourceRef).toBe(`codeblock:${id}:1`);
  });
});
