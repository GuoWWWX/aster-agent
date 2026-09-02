import {
  Activity,
  Aperture,
  Atom,
  BadgeCheck,
  Binary,
  Blocks,
  BookOpen,
  Bot,
  Box,
  BrainCircuit,
  BriefcaseBusiness,
  Brush,
  Bug,
  ChartNoAxesCombined,
  CheckCheck,
  CircleUserRound,
  ClipboardCheck,
  Cloud,
  Code2,
  Cog,
  Compass,
  Cpu,
  Crosshair,
  Crown,
  Database,
  FileSearch,
  Fingerprint,
  FlaskConical,
  Gauge,
  Gem,
  GitBranch,
  Globe2,
  GraduationCap,
  Hammer,
  HeartHandshake,
  KeyRound,
  Languages,
  Laptop,
  Library,
  Lightbulb,
  Link2,
  Microscope,
  Network,
  PackageCheck,
  Palette,
  PenTool,
  Puzzle,
  Radar,
  Rocket,
  Route,
  ScanSearch,
  Search,
  ServerCog,
  Settings,
  Shapes,
  ShieldCheck,
  Sparkles,
  Telescope,
  Terminal,
  TestTube2,
  Wrench,
  Workflow,
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
  { icon: Activity, id: "activity", label: "状态", tone: "emerald" },
  { icon: Aperture, id: "aperture", label: "视觉", tone: "violet" },
  { icon: Atom, id: "atom", label: "科研", tone: "cyan" },
  { icon: BadgeCheck, id: "badge-check", label: "认证", tone: "emerald" },
  { icon: Binary, id: "binary", label: "算法", tone: "blue" },
  { icon: Blocks, id: "blocks", label: "架构", tone: "violet" },
  { icon: Box, id: "box", label: "封装", tone: "amber" },
  { icon: BriefcaseBusiness, id: "briefcase", label: "项目", tone: "blue" },
  { icon: Brush, id: "brush", label: "绘图", tone: "rose" },
  { icon: ChartNoAxesCombined, id: "chart", label: "分析", tone: "cyan" },
  { icon: CheckCheck, id: "check-check", label: "验收", tone: "emerald" },
  { icon: CircleUserRound, id: "user", label: "用户", tone: "blue" },
  { icon: ClipboardCheck, id: "clipboard-check", label: "检查", tone: "emerald" },
  { icon: Cloud, id: "cloud", label: "云服务", tone: "cyan" },
  { icon: Cog, id: "cog", label: "配置", tone: "amber" },
  { icon: Cpu, id: "cpu", label: "计算", tone: "violet" },
  { icon: Crosshair, id: "crosshair", label: "定位", tone: "rose" },
  { icon: Crown, id: "crown", label: "负责人", tone: "amber" },
  { icon: FileSearch, id: "file-search", label: "文件检索", tone: "cyan" },
  { icon: Fingerprint, id: "fingerprint", label: "身份安全", tone: "emerald" },
  { icon: Gauge, id: "gauge", label: "性能", tone: "blue" },
  { icon: Gem, id: "gem", label: "精选", tone: "violet" },
  { icon: GitBranch, id: "git-branch", label: "版本控制", tone: "rose" },
  { icon: Globe2, id: "globe", label: "网络", tone: "cyan" },
  { icon: GraduationCap, id: "graduation-cap", label: "学习", tone: "blue" },
  { icon: HeartHandshake, id: "handshake", label: "协作", tone: "rose" },
  { icon: KeyRound, id: "key", label: "密钥", tone: "amber" },
  { icon: Languages, id: "languages", label: "翻译", tone: "violet" },
  { icon: Laptop, id: "laptop", label: "桌面", tone: "blue" },
  { icon: Library, id: "library", label: "知识库", tone: "emerald" },
  { icon: Link2, id: "link", label: "集成", tone: "cyan" },
  { icon: Microscope, id: "microscope", label: "深度分析", tone: "violet" },
  { icon: Network, id: "network", label: "网络拓扑", tone: "cyan" },
  { icon: PackageCheck, id: "package-check", label: "发布包", tone: "emerald" },
  { icon: PenTool, id: "pen-tool", label: "交互设计", tone: "rose" },
  { icon: Puzzle, id: "puzzle", label: "插件", tone: "violet" },
  { icon: Radar, id: "radar", label: "监控", tone: "cyan" },
  { icon: Route, id: "route", label: "路由", tone: "blue" },
  { icon: ScanSearch, id: "scan-search", label: "扫描", tone: "cyan" },
  { icon: ServerCog, id: "server-cog", label: "运维", tone: "amber" },
  { icon: Settings, id: "settings", label: "设置", tone: "blue" },
  { icon: Shapes, id: "shapes", label: "产品设计", tone: "rose" },
  { icon: Telescope, id: "telescope", label: "研究", tone: "violet" },
  { icon: TestTube2, id: "test-tube", label: "测试", tone: "emerald" },
  { icon: Workflow, id: "workflow", label: "工作流", tone: "blue" },
] as const;

const ICONS: Record<AgentAvatarIcon, LucideIcon> = Object.fromEntries(
  AGENT_AVATAR_ICON_OPTIONS.map((option) => [option.id, option.icon]),
) as Record<AgentAvatarIcon, LucideIcon>;

const TONES: Record<AgentAvatarIcon, (typeof AGENT_AVATAR_ICON_OPTIONS)[number]["tone"]> =
  Object.fromEntries(
    AGENT_AVATAR_ICON_OPTIONS.map((option) => [option.id, option.tone]),
  ) as Record<AgentAvatarIcon, (typeof AGENT_AVATAR_ICON_OPTIONS)[number]["tone"]>;

export function resolveAgentAvatarIcon(icon: AgentAvatarIcon): LucideIcon {
  return ICONS[icon];
}

const SUBAGENT_IDENTICON_TONES = [
  "blue",
  "cyan",
  "emerald",
  "amber",
  "rose",
  "violet",
] as const;

export type SubagentIdenticon = {
  cells: Array<{ x: number; y: number }>;
  tone: (typeof SUBAGENT_IDENTICON_TONES)[number];
};

function hashIdenticonSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

function nextIdenticonValue(value: number): number {
  let next = value || 0x9e3779b9;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

export function createSubagentIdenticon(seed: string): SubagentIdenticon {
  const hash = hashIdenticonSeed(seed);
  const cells: SubagentIdenticon["cells"] = [];
  let state = hash;
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      state = nextIdenticonValue(state);
      const filled = (state & 1) === 1 || (x === 2 && y === 2);
      if (!filled) continue;
      cells.push({ x, y });
      if (x !== 2) cells.push({ x: 4 - x, y });
    }
  }
  return {
    cells,
    tone: SUBAGENT_IDENTICON_TONES[hash % SUBAGENT_IDENTICON_TONES.length] ?? "violet",
  };
}

export function SubagentAvatar({
  icon,
  seed,
  size = "regular",
  status,
}: {
  icon: AgentAvatarIcon | null | undefined;
  seed: string;
  size?: "compact" | "large" | "regular";
  status?: AgentStatus;
}): ReactElement {
  if (icon !== null && icon !== undefined) {
    return (
      <AgentAvatar
        avatar={{ icon, kind: "icon" }}
        size={size}
        {...(status === undefined ? {} : { status })}
      />
    );
  }

  const identicon = createSubagentIdenticon(seed);
  return (
    <span
      aria-hidden="true"
      className="agent-profile-avatar"
      data-size={size}
      data-status={status}
      data-subagent-avatar="generated"
      data-tone={identicon.tone}
    >
      <svg focusable="false" shapeRendering="crispEdges" viewBox="0 0 5 5">
        {identicon.cells.map((cell) => (
          <rect fill="currentColor" height="1" key={`${cell.x}:${cell.y}`} width="1" x={cell.x} y={cell.y} />
        ))}
      </svg>
    </span>
  );
}

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
