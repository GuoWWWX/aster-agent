import { X } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useNativeOverlayContainer } from "../../components/ui/native-overlay-provider.js";
import type { SidebarTab, TabContextMenuState } from "./sidebar-workspace-types.js";

export function SidebarTabContextMenu({
  tabs,
  tabContextMenu,
  onClose,
  onDismiss,
}: {
  tabs: readonly SidebarTab[];
  tabContextMenu: TabContextMenuState;
  onClose: (tabs: SidebarTab[]) => void;
  onDismiss: () => void;
}): ReactElement {
  const nativeOverlayContainer = useNativeOverlayContainer();
  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss]);
  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="right-sidebar-workspace__context-menu-backdrop"
        data-native-view-overlay=""
        onMouseDown={() => onDismiss()}
      />
      <div
        className="right-sidebar-workspace__context-menu"
        role="menu"
        style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
      >
        <button role="menuitem" type="button" onClick={() => onClose([tabContextMenu.tab])}>
          <X aria-hidden="true" size={16} />
          关闭
        </button>
        <button
          disabled={tabs.length <= 1}
          role="menuitem"
          type="button"
          onClick={() => onClose(tabs.filter((tab) => tab.id !== tabContextMenu.tab.id))}
        >
          <X aria-hidden="true" size={16} />
          关闭其他
        </button>
        <button role="menuitem" type="button" onClick={() => onClose([...tabs])}>
          <X aria-hidden="true" size={16} />
          关闭全部
        </button>
      </div>
    </>,
    nativeOverlayContainer ?? document.body,
  );
}
