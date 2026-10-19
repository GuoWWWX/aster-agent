import { FolderOpen, Globe2, MessageSquarePlus, SquareCheckBig, Terminal, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

type EmptyStateAction = {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: (() => void) | undefined;
  shortcut: string;
  title?: string | undefined;
};

export function RightSidebarEmptyState({
  canOpenBrowser,
  canOpenGitReview,
  canOpenTerminal,
  canCreateSideChat,
  isCreatingChat,
  onCreateSideChat,
  onOpenBrowser,
  onOpenFiles,
  onOpenGitReview,
  onOpenTerminal,
}: {
  canOpenBrowser: boolean;
  canOpenGitReview: boolean;
  canOpenTerminal: boolean;
  canCreateSideChat: boolean;
  isCreatingChat: boolean;
  onCreateSideChat: () => void;
  onOpenBrowser: () => void;
  onOpenFiles: () => void;
  onOpenGitReview: () => void;
  onOpenTerminal: () => void;
}): ReactElement {
  const actions: EmptyStateAction[] = [
    {
      disabled: !canOpenGitReview,
      icon: SquareCheckBig,
      label: "审阅",
      onClick: onOpenGitReview,
      shortcut: "Ctrl+Shift+G",
      title: canOpenGitReview ? undefined : "请先打开一个 Git 项目",
    },
    {
      disabled: !canOpenTerminal,
      icon: Terminal,
      label: "终端",
      onClick: onOpenTerminal,
      shortcut: "Ctrl+`",
      title: canOpenTerminal ? undefined : "请先打开项目",
    },
    {
      disabled: !canOpenBrowser,
      icon: Globe2,
      label: "浏览器",
      onClick: onOpenBrowser,
      shortcut: "Ctrl+T",
      title: canOpenBrowser ? undefined : "当前运行环境未接入浏览器",
    },
    {
      icon: FolderOpen,
      label: "文件",
      onClick: onOpenFiles,
      shortcut: "Ctrl+P",
    },
    {
      disabled: !canCreateSideChat || isCreatingChat,
      icon: MessageSquarePlus,
      label: "侧边聊天",
      onClick: onCreateSideChat,
      shortcut: "Ctrl+Alt+S",
      title: canCreateSideChat ? undefined : "请先打开一个主对话",
    },
  ];

  return (
    <div className="right-sidebar-workspace__empty" aria-label="打开工作区标签">
      <div className="right-sidebar-workspace__empty-actions" role="group" aria-label="可打开的工作区标签">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              aria-label={action.label}
              className="right-sidebar-workspace__empty-action"
              disabled={action.disabled}
              key={action.label}
              title={action.title}
              type="button"
              onClick={() => action.onClick?.()}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
              <span>{action.label}</span>
              <kbd aria-hidden="true">{action.shortcut}</kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}
