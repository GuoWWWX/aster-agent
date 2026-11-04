// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createPastedTextAttachment } from "./pasted-text-attachment.js";

it("keeps short text native and converts text above either threshold", () => {
  expect(createPastedTextAttachment("字".repeat(2_000))).toBeNull();
  expect(createPastedTextAttachment("字".repeat(2_001))?.type).toBe("text/plain");
  expect(createPastedTextAttachment(Array(20).fill("行").join("\r\n"))).toBeNull();
  for (const newline of ["\n", "\r\n", "\r"]) {
    expect(createPastedTextAttachment(Array(21).fill("行").join(newline))?.name).toMatch(/\.txt$/);
  }
});

it("preserves UTF-8 text, whitespace and line endings in the TXT bytes", async () => {
  vi.spyOn(Date, "now").mockReturnValue(123);
  const text = `  中文 😀\r\n${"完整原文\n".repeat(21)}末尾  `;
  try {
    const file = createPastedTextAttachment(text)!;
    expect(file.name).toBe("粘贴文本-123.txt");
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Expected text from FileReader."));
      };
      reader.onerror = reject;
      reader.readAsText(file, "utf-8");
    });
    expect(contents).toBe(text);
  } finally {
    vi.restoreAllMocks();
  }
});
