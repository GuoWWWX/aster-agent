import { FolderOpen, Globe2, Plus, SquareCheckBig, SquarePen, Terminal } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { IconButton } from "../../components/ui/icon-button.js";
import { Spinner } from "../../components/ui/loading.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";

export function SidebarWorkspaceAddMenu({
  hasActiveBrowser,
  hasProject,
  canOpenGitReview,
  canOpenTerminal,
  canOpenBrowser,
  canCreateSideChat,
  isCreatingChat,
  menuOpen,
  onMenuOpenChange,
  onNativeAddMenu,
  onOpenGitReview,
  onOpenTerminal,
  onOpenBrowser,
  onOpenFiles,
  onCreateSideChat,
}: {
  hasActiveBrowser: boolean;
  hasProject: boolean;
  canOpenGitReview: boolean;
  canOpenTerminal: boolean;
  canOpenBrowser: boolean;
  canCreateSideChat: boolean;
  isCreatingChat: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onNativeAddMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpenGitReview: () => void;
  onOpenTerminal: () => void;
  onOpenBrowser: () => void;
  onOpenFiles: () => void;
  onCreateSideChat: () => void;
}): ReactElement {
  return (
    <>
      {hasActiveBrowser ? (
        <IconButton
          className="right-sidebar-workspace__add"
          label="打开项目"
          size="compact"
          onClick={(event) => onNativeAddMenu(event)}
        >
          <Plus aria-hidden="true" size={16} />
        </IconButton>
      ) : (
        <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
          <PopoverTrigger asChild>
            <IconButton className="right-sidebar-workspace__add" label="打开项目" size="compact">
              <Plus aria-hidden="true" size={16} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="right-sidebar-workspace__menu"
            side="bottom"
            sideOffset={5}
          >
          <button
            disabled={!canOpenGitReview}
            title={!hasProject ? "请先打开项目" : undefined}
            type="button"
            onClick={onOpenGitReview}
          >
            <SquareCheckBig aria-hidden="true" size={15} />
            审阅
          </button>
          <button
            disabled={!canOpenTerminal}
            title={!hasProject ? "请先打开项目" : undefined}
            type="button"
            onClick={() => {
              onOpenTerminal();
            }}
          >
            <Terminal aria-hidden="true" size={15} />
            终端
          </button>
          <button
            disabled={!canOpenBrowser}
            type="button"
            onClick={onOpenBrowser}
          >
            <Globe2 aria-hidden="true" size={15} />
            浏览器
          </button>
          <button
            type="button"
            onClick={onOpenFiles}
          >
            <FolderOpen aria-hidden="true" size={15} />
            文件
          </button>
          <button
            disabled={!canCreateSideChat || isCreatingChat}
            type="button"
            onClick={() => onCreateSideChat()}
          >
            {isCreatingChat ? (
              <Spinner aria-hidden="true" size={15} />
            ) : (
              <SquarePen aria-hidden="true" size={15} />
            )}
            侧边聊天
          </button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
