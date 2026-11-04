import { Icon } from "@iconify/react";
import type { ReactElement } from "react";

import type { JavaDeclarationKind } from "@agent/protocol";

import { fileTypeIconPresentation } from "./file-type-icon-data.js";

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
  const presentation = fileTypeIconPresentation(path, javaDeclarationKind);
  if (presentation.kind === "java") {
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
      icon={presentation.icon}
      width={size}
    />
  );
}
