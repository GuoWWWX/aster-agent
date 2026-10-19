import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";

export function textContextMenuItems(
  params: Pick<ContextMenuParams, "isEditable" | "selectionText" | "editFlags">,
): MenuItemConstructorOptions[] {
  const copy: MenuItemConstructorOptions = {
    label: "复制", role: "copy", enabled: params.editFlags.canCopy,
  };
  if (!params.isEditable) return params.selectionText.length > 0 ? [copy] : [];
  return [
    { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
    copy,
    { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
  ];
}

export function installTextContextMenu(window: BrowserWindow): () => void {
  const contents = window.webContents;
  const showMenu = (_event: Electron.Event, params: ContextMenuParams): void => {
    const items = textContextMenuItems(params);
    if (params.mediaType === "image" && params.hasImageContents) {
      if (items.length > 0) items.unshift({ type: "separator" });
      items.unshift({ label: "复制图片", click: () => {
        if (!contents.isDestroyed()) contents.copyImageAt(params.x, params.y);
      } });
    }
    if (items.length === 0) return;
    Menu.buildFromTemplate(items).popup({ window });
  };
  contents.on("context-menu", showMenu);
  return () => { contents.removeListener("context-menu", showMenu); };
}
