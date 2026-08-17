import {
  Bot,
  Code2,
  Compass,
  Hammer,
  ShieldCheck,
  Sparkles,
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
}[] = [
  { icon: Bot, id: "bot", label: "通用" },
  { icon: Sparkles, id: "sparkles", label: "调度" },
  { icon: Compass, id: "compass", label: "探索" },
  { icon: Code2, id: "code", label: "代码" },
  { icon: Hammer, id: "hammer", label: "实现" },
  { icon: ShieldCheck, id: "shield", label: "审查" },
] as const;

const ICONS: Record<AgentAvatarIcon, LucideIcon> = Object.fromEntries(
  AGENT_AVATAR_ICON_OPTIONS.map((option) => [option.id, option.icon]),
) as Record<AgentAvatarIcon, LucideIcon>;

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
    >
      {avatar.kind === "image" ? (
        <img alt="" src={avatar.dataUrl} />
      ) : Icon === null ? null : (
        <Icon strokeWidth={1.8} />
      )}
    </span>
  );
}
