import defaultFile from "@iconify-icons/vscode-icons/default-file";
import fileTypeCss from "@iconify-icons/vscode-icons/file-type-css";
import fileTypeDocker from "@iconify-icons/vscode-icons/file-type-docker";
import fileTypeHtml from "@iconify-icons/vscode-icons/file-type-html";
import fileTypeImage from "@iconify-icons/vscode-icons/file-type-image";
import fileTypeJs from "@iconify-icons/vscode-icons/file-type-js";
import fileTypeJson from "@iconify-icons/vscode-icons/file-type-json";
import fileTypeMarkdown from "@iconify-icons/vscode-icons/file-type-markdown";
import fileTypePdf from "@iconify-icons/vscode-icons/file-type-pdf2";
import fileTypePython from "@iconify-icons/vscode-icons/file-type-python";
import fileTypeReactJs from "@iconify-icons/vscode-icons/file-type-reactjs";
import fileTypeReactTs from "@iconify-icons/vscode-icons/file-type-reactts";
import fileTypeShell from "@iconify-icons/vscode-icons/file-type-shell";
import fileTypeSql from "@iconify-icons/vscode-icons/file-type-sql";
import fileTypeTypescript from "@iconify-icons/vscode-icons/file-type-typescript";
import fileTypeVue from "@iconify-icons/vscode-icons/file-type-vue";
import fileTypeXml from "@iconify-icons/vscode-icons/file-type-xml";
import fileTypeYaml from "@iconify-icons/vscode-icons/file-type-yaml";
import { Icon } from "@iconify/react";
import type { ReactElement } from "react";
import type { JavaDeclarationKind } from "@agent/protocol";

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function iconForPath(path: string) {
  const name = path.replaceAll("\\", "/").split("/").at(-1)?.toLocaleLowerCase("en-US") ?? "";
  const extension = name.split(".").at(-1) ?? "";

  if (IMAGE_EXTENSIONS.has(extension)) return fileTypeImage;
  if (name === "dockerfile" || extension === "dockerfile") return fileTypeDocker;

  switch (extension) {
    case "md":
    case "mdx":
      return fileTypeMarkdown;
    case "json":
    case "jsonc":
      return fileTypeJson;
    case "js":
    case "mjs":
    case "cjs":
      return fileTypeJs;
    case "jsx":
      return fileTypeReactJs;
    case "ts":
    case "mts":
    case "cts":
      return fileTypeTypescript;
    case "tsx":
      return fileTypeReactTs;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return fileTypeCss;
    case "html":
    case "htm":
      return fileTypeHtml;
    case "vue":
      return fileTypeVue;
    case "yaml":
    case "yml":
      return fileTypeYaml;
    case "xml":
      return fileTypeXml;
    case "py":
      return fileTypePython;
    case "sh":
    case "bash":
    case "zsh":
    case "ps1":
      return fileTypeShell;
    case "sql":
      return fileTypeSql;
    case "pdf":
      return fileTypePdf;
    default:
      return defaultFile;
  }
}

export function FileTypeIcon({
  className,
  javaDeclarationKind,
  path,
  size = 16,
}: {
  className?: string;
  javaDeclarationKind?: JavaDeclarationKind | undefined;
  path: string;
  size?: number;
}): ReactElement {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US");
  if (extension === "java" || extension === "class") {
    const kind = extension === "class" ? "class" : javaDeclarationKind ?? "class";
    const presentation = {
      annotation: { color: "#b7791f", label: "A" },
      class: { color: "#3b82f6", label: "C" },
      enum: { color: "#c77700", label: "E" },
      interface: { color: "#3f9f58", label: "I" },
      record: { color: "#8b5cf6", label: "R" },
    }[kind];
    return (
      <span
        aria-hidden="true"
        className={["file-type-icon--java", className].filter(Boolean).join(" ")}
        style={{
          alignItems: "center",
          border: "1.5px solid currentColor",
          borderRadius: "50%",
          boxSizing: "border-box",
          color: presentation.color,
          display: "inline-flex",
          flex: "0 0 auto",
          fontFamily: "Arial, sans-serif",
          fontSize: Math.max(8, Math.round(size * 0.56)),
          fontWeight: 700,
          height: size,
          justifyContent: "center",
          lineHeight: 1,
          width: size,
        }}
      >
        {presentation.label}
      </span>
    );
  }

  return (
    <Icon
      aria-hidden="true"
      className={className}
      height={size}
      icon={iconForPath(path)}
      width={size}
    />
  );
}
