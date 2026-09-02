import { describe, expect, it } from "vitest";
import { markdownCaptionText, mermaidFenceCaption } from "./mermaid-fence.js";

describe("Mermaid Markdown captions", () => {
  it("reads a caption attribute from a Mermaid fence", () => {
    expect(mermaidFenceCaption('mermaid {caption="图9-1 商密服务异常下的受控处置流程" width=90%}'))
      .toBe("图9-1 商密服务异常下的受控处置流程");
    expect(mermaidFenceCaption("mermaid caption='图 2-1 网络结构图'"))
      .toBe("图 2-1 网络结构图");
    expect(mermaidFenceCaption("mermaid {width=90%}")).toBeUndefined();
  });

  it("accepts only a fully bold line as an adjacent caption", () => {
    expect(markdownCaptionText("**图9-1 处置流程**")).toBe("图9-1 处置流程");
    expect(markdownCaptionText("普通 **加粗** 正文")).toBeUndefined();
    expect(markdownCaptionText("::caption[图9-1 旧语法]")).toBeUndefined();
  });
});
