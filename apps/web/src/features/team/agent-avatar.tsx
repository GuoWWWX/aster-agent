import {
  BookOpen,
  Bot,
  BrainCircuit,
  Bug,
  Code2,
  Compass,
  Database,
  FlaskConical,
  Hammer,
  Lightbulb,
  Palette,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

import type {
  AgentAvatar as AgentAvatarValue,
  AgentAvatarIcon,
  AgentStatus,
} from "../../stores/agent-directory-store.js";
import "./agent-avatar.css";

export const AGENT_AVATAR_ICON_OPTIONS: readonly {
  icon: LucideIcon;
  id: AgentAvatarIcon;
  label: string;
  tone: "amber" | "blue" | "cyan" | "emerald" | "rose" | "violet";
}[] = [
  { icon: Bot, id: "bot", label: "通用", tone: "blue" },
  { icon: Sparkles, id: "sparkles", label: "调度", tone: "violet" },
  { icon: Compass, id: "compass", label: "探索", tone: "cyan" },
  { icon: Code2, id: "code", label: "代码", tone: "blue" },
  { icon: Hammer, id: "hammer", label: "实现", tone: "amber" },
  { icon: ShieldCheck, id: "shield", label: "审查", tone: "emerald" },
  { icon: BrainCircuit, id: "brain", label: "推理", tone: "violet" },
  { icon: Bug, id: "bug", label: "调试", tone: "rose" },
  { icon: Database, id: "database", label: "数据", tone: "cyan" },
  { icon: FlaskConical, id: "flask", label: "实验", tone: "emerald" },
  { icon: Palette, id: "palette", label: "设计", tone: "rose" },
  { icon: Rocket, id: "rocket", label: "发布", tone: "violet" },
  { icon: Search, id: "search", label: "搜索", tone: "cyan" },
  { icon: Terminal, id: "terminal", label: "终端", tone: "blue" },
  { icon: Wrench, id: "wrench", label: "工具", tone: "amber" },
  { icon: BookOpen, id: "book", label: "文档", tone: "emerald" },
  { icon: Lightbulb, id: "lightbulb", label: "创意", tone: "amber" },
  { icon: Zap, id: "zap", label: "快速", tone: "rose" },
] as const;

const ICONS: Record<AgentAvatarIcon, LucideIcon> = Object.fromEntries(
  AGENT_AVATAR_ICON_OPTIONS.map((option) => [option.id, option.icon]),
) as Record<AgentAvatarIcon, LucideIcon>;

const TONES: Record<AgentAvatarIcon, (typeof AGENT_AVATAR_ICON_OPTIONS)[number]["tone"]> =
  Object.fromEntries(
    AGENT_AVATAR_ICON_OPTIONS.map((option) => [option.id, option.tone]),
  ) as Record<AgentAvatarIcon, (typeof AGENT_AVATAR_ICON_OPTIONS)[number]["tone"]>;

export function AgentAvatar({
  avatar,
  size = "regular",
  status,
}: {
  avatar: AgentAvatarValue;
  size?: "compact" | "large" | "regular";
  status?: AgentStatus;
}): ReactElement {
  const Icon = avatar.kind === "icon" ? ICONS[avatar.icon] : null;

  return (
    <span
      aria-hidden="true"
      className="agent-profile-avatar"
      data-size={size}
      data-status={status}
      data-tone={avatar.kind === "icon" ? TONES[avatar.icon] : undefined}
    >
      {avatar.kind === "image" ? (
        <img alt="" src={avatar.dataUrl} />
      ) : Icon === null ? null : (
        <Icon strokeWidth={1.8} />
      )}
    </span>
  );
}
