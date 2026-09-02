import { describe, expect, it } from "vitest";

import {
  fileTypeIconMarkup,
  isRecognizedFileTypePath,
} from "./file-type-icon-data.js";

describe("FileTypeIcon", () => {
  it("uses compact folded paper icons for document files", () => {
    expect(isRecognizedFileTypePath("notes.txt")).toBe(true);
    expect(isRecognizedFileTypePath("NOTES.TXT")).toBe(true);
    expect(fileTypeIconMarkup("notes.txt")).toContain('data-document-kind="txt"');
    expect(fileTypeIconMarkup("notes.txt")).toContain('d="M22.038 2H6.375');
    expect(fileTypeIconMarkup("notes.txt")).not.toContain("<rect");
    expect(fileTypeIconMarkup("notes.txt")).not.toContain(">txt</text>");
    expect(fileTypeIconMarkup("README.md")).toContain('data-document-kind="md"');
    expect(fileTypeIconMarkup("README.mdx")).toContain('data-document-kind="md"');
    expect(fileTypeIconMarkup("README.md")).toContain("#755838");
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

  it("does not classify an ordinary website as a file path", () => {
    expect(isRecognizedFileTypePath("https://example.com")).toBe(false);
  });
});
