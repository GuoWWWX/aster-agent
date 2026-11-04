import { describe, expect, it } from "vitest";

import {
  fileTypeIconMarkup,
  isRecognizedFileTypePath,
} from "./file-type-icon-data.js";

describe("FileTypeIcon", () => {
  it("uses theme-aware extension badges for text document files", () => {
    expect(isRecognizedFileTypePath("notes.txt")).toBe(true);
    expect(isRecognizedFileTypePath("NOTES.TXT")).toBe(true);
    expect(fileTypeIconMarkup("notes.txt")).toContain('data-document-kind="txt"');
    expect(fileTypeIconMarkup("notes.txt")).toContain("<rect");
    expect(fileTypeIconMarkup("notes.txt")).toContain('fill="currentColor"');
    expect(fileTypeIconMarkup("notes.txt")).toContain(">TXT</text>");
    expect(fileTypeIconMarkup("README.md")).toContain('data-document-kind="md"');
    expect(fileTypeIconMarkup("README.md")).toContain(">MD</text>");
    expect(fileTypeIconMarkup("README.mdx")).toContain('data-document-kind="mdx"');
    expect(fileTypeIconMarkup("README.mdx")).toContain(">MDX</text>");
    expect(fileTypeIconMarkup("README.md")).not.toContain("#755838");
    expect(fileTypeIconMarkup("guide.pdf")).toContain('data-document-kind="pdf"');
    expect(fileTypeIconMarkup("guide.pdf")).toContain("#dc2626");
  });

  it("distinguishes modern and legacy Word formats", () => {
    expect(isRecognizedFileTypePath("docs/report.doc")).toBe(true);
    expect(isRecognizedFileTypePath("docs/report.docx?download=1")).toBe(true);
    expect(fileTypeIconMarkup("docs/report.docx")).toContain("<svg");
    expect(fileTypeIconMarkup("docs/report.docx")).toContain('data-office-variant="solid"');
    expect(fileTypeIconMarkup("docs/report.doc")).toContain('data-office-variant="outline"');
    expect(fileTypeIconMarkup("docs/report.docx")).toContain('d="M9.5 2.5h12l7 7v20h-19Z"');
    expect(fileTypeIconMarkup("docs/report.docx")).not.toBe(fileTypeIconMarkup("docs/report.doc"));
    expect(fileTypeIconMarkup("docs/report.docx")).not.toBe(fileTypeIconMarkup("docs/report.unknown"));
  });

  it("uses matching solid and outlined variants for spreadsheet and presentation formats", () => {
    expect(isRecognizedFileTypePath("data/report.csv")).toBe(true);
    expect(isRecognizedFileTypePath("data/report.tsv")).toBe(true);
    expect(fileTypeIconMarkup("data/report.xlsx")).toContain('data-office-variant="solid"');
    expect(fileTypeIconMarkup("data/report.csv")).toContain('data-office-variant="outline"');
    expect(fileTypeIconMarkup("data/report.xlsx")).not.toBe(fileTypeIconMarkup("data/report.xls"));
    expect(fileTypeIconMarkup("data/report.xlsx")).not.toBe(fileTypeIconMarkup("data/report.csv"));
    expect(fileTypeIconMarkup("slides/report.pptx")).not.toBe(fileTypeIconMarkup("slides/report.ppt"));
  });

  it("uses a dedicated Rust icon instead of the generic file icon", () => {
    expect(isRecognizedFileTypePath("src/core/convert.rs")).toBe(true);
    expect(fileTypeIconMarkup("src/core/convert.rs")).not.toBe(fileTypeIconMarkup("src/core/convert.unknown"));
    expect(fileTypeIconMarkup("src/core/convert.rs")).toContain("<svg");
  });

  it("uses a dedicated Git icon for .gitignore files", () => {
    expect(isRecognizedFileTypePath(".gitignore")).toBe(true);
    expect(isRecognizedFileTypePath("nested/.GITIGNORE")).toBe(true);
    expect(fileTypeIconMarkup(".gitignore")).toContain("#dd4c35");
    expect(fileTypeIconMarkup(".gitignore")).not.toBe(fileTypeIconMarkup(".unknown"));
  });

  it("does not classify an ordinary website as a file path", () => {
    expect(isRecognizedFileTypePath("https://example.com")).toBe(false);
  });
});
