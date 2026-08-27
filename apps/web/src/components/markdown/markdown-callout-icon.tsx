import {
  Bug,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  ListTree,
  MessageSquareQuote,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { createElement, type ReactElement } from "react";

import type { MarkdownCalloutTone } from "../../lib/markdown-callout.js";

export function markdownCalloutIcon(type: string, tone: MarkdownCalloutTone): LucideIcon {
  if (type === "abstract" || type === "summary" || type === "tldr") return ClipboardList;
  if (type === "bug") return Bug;
  if (type === "example") return ListTree;
  if (tone === "green") return type === "success" || type === "check" ? CircleCheck : Lightbulb;
  if (tone === "amber") return type === "question" || type === "help" ? CircleHelp : TriangleAlert;
  if (tone === "red") return CircleX;
  if (tone === "slate") return MessageSquareQuote;
  return Info;
}

/**
 * 图标按 type/tone 动态选择，因此用 createElement 而非 `<Icon />`：
 * 把查表结果赋给大写变量再当 JSX 标签用，会被识别成“在 render 中创建组件”。
 */
export function MarkdownCalloutIcon({
  type,
  tone,
  className,
}: {
  type: string;
  tone: MarkdownCalloutTone;
  className?: string;
}): ReactElement {
  return createElement(markdownCalloutIcon(type, tone), {
    "aria-hidden": "true",
    className,
  });
}
