import { describe, expect, it } from "vitest";
import { compilePreviewSource } from "./code-preview-compiler.js";
import { ToolArgumentsError } from "../model/tool-arguments.js";

describe("isolated component preview compilation", () => {
  it("preserves ordinary HTML without invoking a compiler", async () => {
    expect(await compilePreviewSource("<svg><circle r='5'/></svg>", "html")).toBe("<svg><circle r='5'/></svg>");
  });
  it("bundles React hooks and TypeScript locally without a CDN", async () => {
    const html = await compilePreviewSource('import {useState} from "react"; export default function App(){const [n,setN]=useState<number>(0);return <button onClick={()=>setN(n+1)}>{n}</button>}', "react");
    expect(html).toContain('id="root"'); expect(html).toContain("<script>");
    expect(html).not.toMatch(/src=["']https?:/u); expect(html).not.toContain("useState<number>");
  });
  it("accepts a bare JSX expression", async () => {
    expect(await compilePreviewSource('<div aria-label="demo">Hello</div>', "react")).toContain("Hello");
  });
  it("compiles Vue script setup, template and scoped CSS", async () => {
    const html = await compilePreviewSource('<script setup lang="ts">import {ref} from "vue"; const n=ref<number>(0)</script><template><button @click="n++">{{n}}</button></template><style scoped>button{color:red}</style>', "vue");
    expect(html).toContain("data-v-"); expect(html).toMatch(/color:\s*red/u); expect(html).not.toContain('lang="ts"');
  });
  it("compiles template-only and options-API Vue components", async () => {
    expect(await compilePreviewSource('<template><h1>模板</h1></template>', "vue")).toContain("模板");
    expect(await compilePreviewSource('<script>export default {data(){return {message:"选项"}}}</script><template><h1>{{message}}</h1></template>', "vue")).toContain("选项");
  });
  it.each(['import "node:fs"; export default ()=>null', 'import "./secret.js"; export default ()=>null', 'import "https://example.com/x.js"; export default ()=>null'])("rejects imports outside the bundled preview runtimes", async source => {
      await expect(compilePreviewSource(source, "react")).rejects.toThrow(/预览|import/u);
    });
  it("rejects invalid source and external Vue blocks", async () => {
    const error: unknown = await compilePreviewSource('export default function (', "react").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ToolArgumentsError);
    if (!(error instanceof ToolArgumentsError)) throw error;
    expect(error.code).toBe("TOOL_ARGUMENTS_INVALID");
    expect(error.issues[0]?.path).toEqual(["code"]); expect(error.issues[0]?.message).toContain("line 1:");
    await expect(compilePreviewSource('<script src="./secret.js"></script><template>Hi</template>', "vue")).rejects.toThrow(/src/u);
    await expect(compilePreviewSource('<template lang="pug">h1 Hi</template>', "vue")).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" });
  });
});
